"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCapability, requireLocationAccess, ForbiddenError } from "@/lib/auth/session";
import { parseHpsBuffer } from "@/lib/rab/hps-parser";
import { flattenParsedRab, grandTotal } from "@/lib/rab/flatten";
import { activateRevision, createRevisionFromParsed, regenerateBaseline } from "@/lib/rab/import";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { isR2Configured, r2Put } from "@/lib/r2";

/**
 * Impor HPS/adendum — SATU server action, dua langkah dalam satu form multipart:
 *   1. tanpa `confirm` → parse + pratinjau (TIDAK menyimpan apa pun)
 *   2. `confirm=1` + sha256 pratinjau cocok → simpan revisi (draft) → aktifkan
 *      → regenerate baseline (+ arsip file ke R2 best-effort)
 * File dikirim ulang di langkah 2 (File tidak bisa disimpan di state), sha256
 * menjaga file yang di-commit = file yang dipratinjau.
 */

const MAX_BYTES = 15 * 1024 * 1024; // di bawah bodySizeLimit 16mb
const XLSX_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

export type ImportPreview = {
  fileName: string;
  bytes: number;
  sha256: string;
  /** Σ kategori pra-PPN, rupiah string. */
  grandTotal: string;
  itemCount: number;
  isAdendum: boolean;
  warnings: string[];
  categories: { code: string; name: string; total: string }[];
  /** Diisi bila file berubah setelah pratinjau — commit ditolak, pratinjau diperbarui. */
  notice?: string;
};

export type ImportState = { error?: string; success?: string; preview?: ImportPreview } | undefined;

function safeName(n: string): string {
  return n.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export async function importHps(_prev: ImportState, formData: FormData): Promise<ImportState> {
  try {
    const user = await requireCapability("rab.manage");
    const locId = z.uuid().safeParse(formData.get("locationId"));
    if (!locId.success) return { error: "Lokasi tidak valid." };
    await requireLocationAccess(user, locId.data);
    const location = await db.location.findUniqueOrThrow({
      where: { id: locId.data },
      select: {
        id: true,
        slug: true,
        name: true,
        packageId: true,
        package: { select: { orgId: true, contract: { select: { startDate: true } } } },
      },
    });

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "File HPS (.xlsx) wajib dipilih." };
    if (file.size > MAX_BYTES) return { error: "File terlalu besar (maks 15 MB)." };
    if (!XLSX_MIME.includes(file.type) && !/\.xlsx?$/i.test(file.name)) {
      return { error: "File harus Excel (.xlsx)." };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    let parsed;
    let warnings: string[];
    try {
      ({ parsed, warnings } = await parseHpsBuffer(buffer));
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Gagal membaca file HPS." };
    }
    const nodes = flattenParsedRab(parsed);
    if (nodes.length === 0) return { error: "Tidak ada baris RAB terbaca. Cek sheet 'RAB'." };
    const total = grandTotal(nodes);

    const activeRevision = await db.rabRevision.findFirst({
      where: { locationId: location.id, status: "aktif" },
      select: { id: true },
    });
    // Adendum HANYA bila kontrak sudah SPMK/jalan (startDate terisi). Sebelum SPMK
    // (masih "menunggu SPMK"), impor RAB ulang = KOREKSI HPS awal, bukan adendum
    // resmi. DECISIONS 118.
    const contractStarted = location.package?.contract?.startDate != null;
    const isAdendum = activeRevision !== null && contractStarted;

    // Lineage realisasi yang HILANG di file baru: realisasi item itu tidak akan
    // tersambung ke revisi baru (progress lokasi turun diam-diam). Tampilkan di
    // pratinjau SEBELUM commit — audit 2026-07-27, B17.
    if (activeRevision) {
      const realized = await cumulativeVolumeByLineage(location.id);
      const newItemKeys = new Set(
        nodes.filter((n) => n.kind === "item").map((n) => n.lineageKey),
      );
      const lostKeys = [...realized.entries()]
        .filter(([key, vol]) => vol > 0 && !newItemKeys.has(key))
        .map(([key]) => key);
      if (lostKeys.length > 0) {
        const named = await db.rabNode.findMany({
          where: { revisionId: activeRevision.id, lineageKey: { in: lostKeys } },
          select: { code: true, name: true, lineageKey: true },
        });
        const nameByKey = new Map(named.map((n) => [n.lineageKey, `${n.code} ${n.name}`]));
        const labels = lostKeys.map((k) => nameByKey.get(k) ?? k);
        const shown = labels.slice(0, 8);
        warnings.push(
          `PERHATIAN — ${lostKeys.length} item yang SUDAH punya realisasi tidak ditemukan di file baru: ` +
            `${shown.join("; ")}${labels.length > shown.length ? `; +${labels.length - shown.length} lainnya` : ""}. ` +
            `Realisasi item tersebut TIDAK akan tersambung ke revisi baru sehingga progress lokasi bisa turun. ` +
            `Pastikan kode/struktur item di file sama dengan RAB aktif, atau lanjutkan hanya bila item memang dihapus lewat adendum resmi.`,
        );
      }
    }

    const preview: ImportPreview = {
      fileName: file.name,
      bytes: file.size,
      sha256,
      grandTotal: total.toString(),
      itemCount: nodes.filter((n) => n.kind === "item").length,
      isAdendum,
      warnings,
      categories: nodes
        .filter((n) => n.kind === "kategori")
        .map((n) => ({ code: n.code, name: n.name, total: n.amount.toString() })),
    };

    const confirm = formData.get("confirm") === "1";
    const previewSha = String(formData.get("previewSha") ?? "");
    if (!confirm) return { preview };
    if (previewSha !== sha256) {
      return {
        preview: {
          ...preview,
          notice: "File berubah sejak pratinjau — belum disimpan. Periksa ringkasan baru lalu simpan lagi.",
        },
      };
    }

    // ── Commit: revisi draft → aktif → baseline ─────────────────────────────
    const note = String(formData.get("note") ?? "").trim() || null;
    const source = isAdendum ? ("adendum" as const) : ("hps_awal" as const);
    const res = await createRevisionFromParsed(location.id, parsed, {
      source,
      note,
      userId: user.id,
    });
    await activateRevision(res.revisionId, user.id);
    // Revisi sudah AKTIF di titik ini. Bila regenerate baseline gagal, JANGAN
    // jatuh ke catch generik ("Terjadi kesalahan saat impor") — user akan
    // mengira impor batal padahal revisi sudah berganti dan kurva-S masih
    // memakai baseline lama. Laporkan keadaan campuran itu apa adanya.
    // Audit 2026-07-27, B17.
    let baselineError: string | null = null;
    try {
      await regenerateBaseline(location.id, {
        source: isAdendum ? "adendum" : "auto",
        rabRevisionId: res.revisionId,
        note: `Regenerate otomatis (impor revisi #${res.revisionNo})`,
        userId: user.id,
      });
    } catch (e) {
      console.error("[rab-import] regenerate baseline gagal (revisi sudah aktif):", e);
      baselineError = e instanceof Error ? e.message : "kesalahan tak dikenal";
    }

    // Arsip file sumber ke R2 + Document — best-effort, kegagalan tidak
    // membatalkan revisi yang sudah aktif.
    if (isR2Configured()) {
      try {
        const key = `rab-import/${location.id}/${randomUUID()}-${safeName(file.name)}`;
        await r2Put(key, buffer, file.type || XLSX_MIME[0]);
        const doc = await db.document.create({
          data: {
            orgId: location.package.orgId,
            packageId: location.packageId,
            locationId: location.id,
            phase: isAdendum ? "adendum" : "kontrak",
            type: "hps",
            title: `HPS/RAB ${isAdendum ? `adendum (revisi #${res.revisionNo})` : "awal"} — ${location.name}`,
            r2Key: key,
            fileName: file.name,
            mimeType: file.type || XLSX_MIME[0],
            bytes: file.size,
            sha256,
            uploadedById: user.id,
          },
        });
        await db.rabRevision.update({
          where: { id: res.revisionId },
          data: { sourceDocumentId: doc.id },
        });
      } catch (e) {
        console.error("[rab-import] arsip R2 gagal (revisi tetap tersimpan):", e);
      }
    }

    revalidatePath(`/lokasi/${location.slug}`, "layout");
    revalidatePath("/lokasi");
    revalidatePath("/progress");
    const carryInfo =
      isAdendum && res.carriedItemLineages > 0
        ? ` ${res.carriedItemLineages} item tersambung ke realisasi lama (lineage sama).`
        : "";
    if (baselineError) {
      return {
        error:
          `Revisi RAB #${res.revisionNo} SUDAH AKTIF, tetapi kurva-S GAGAL di-regenerate (${baselineError}). ` +
          `Grafik & deviasi masih memakai baseline lama — buka tab Kurva-S lalu tekan "Hitung ulang kurva-S" untuk menyelaraskan.`,
      };
    }
    return {
      success: `Revisi RAB #${res.revisionNo} (${source === "adendum" ? "adendum" : "HPS awal"}) aktif — ${res.itemCount} item. Baseline kurva-S di-regenerate.${carryInfo}`,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan saat impor." };
  }
}
