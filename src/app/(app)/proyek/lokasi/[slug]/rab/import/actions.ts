"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCapability, requireLocationAccess, ForbiddenError } from "@/lib/auth/session";
import { catatImpor } from "@/lib/import-log/record";
import { parseHpsBuffer } from "@/lib/rab/hps-parser";
import { flattenParsedRab, grandTotal } from "@/lib/rab/flatten";
import { pastikanBolehAktivasi, PersetujuanError } from "@/lib/rab/persetujuan";
import {
  activateRevision,
  createRevisionFromNodes,
  createRevisionFromParsed,
  discardDraft,
  regenerateBaseline,
} from "@/lib/rab/import";
import { AdendumTemplateError } from "@/lib/rab/adendum-template-parse";
import { bandingkanTerhadapAktif, type RingkasBeda } from "@/lib/rab/diff-parsed";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { formatNumber, formatRupiah } from "@/lib/format";
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
  /** Kolom nilai yang dipakai parser — mis. "NEGOSIASI (kolom K/L)". Wajib
   *  terlihat sebelum commit: file lampiran negosiasi memuat 3 blok harga
   *  (HPS/penawaran/negosiasi) dan salah kolom = nilai kontrak salah. */
  priceColumnLabel: string;
  priceSource: "nego" | "penawaran" | "hps";
  warnings: string[];
  categories: { code: string; name: string; total: string }[];
  mode: ImportMode;
  /** Draft yang sudah ada di lokasi ini — isinya akan DIGANTI (mode draft). */
  draftAda: { revisionNo: number; totalValue: string } | null;
  /** Perbandingan terhadap RAB aktif — apa yang akan berubah, sebelum disimpan. */
  beda: {
    totalAktif: string;
    totalBaru: string;
    jumlahTetap: number;
    itemBaru: { code: string; name: string }[];
    itemHilang: { code: string; name: string; realisasi: number }[];
    volumeBerubah: { code: string; name: string; dari: number | null; ke: number | null; realisasi: number; dibawahRealisasi: boolean }[];
    /** Harga satuan item KONTRAK LAMA yang bergeser (DECISIONS 213). */
    hargaBerubah: {
      lineageKey: string;
      code: string;
      name: string;
      dari: number | null;
      ke: number | null;
      /** Rupiah string — BigInt tidak bisa menyeberang ke klien. */
      dampakRupiah: string;
    }[];
  } | null;
  /** Diisi bila file berubah setelah pratinjau — commit ditolak, pratinjau diperbarui. */
  notice?: string;
};

/**
 * Tujuan impor (DECISIONS 209).
 * - `aktifkan` — perilaku lama: revisi baru langsung jadi RAB AKTIF + baseline
 *   di-regenerate. Dipakai untuk HPS awal dan adendum yang SUDAH resmi.
 * - `draft` — isi DRAFT adendum saja. RAB aktif, progres, kurva-S, dan
 *   keuangan tidak tersentuh. Ini yang hilang sebelumnya: satu-satunya jalur
 *   impor selalu mengaktifkan, jadi adendum yang masih diajukan terpaksa
 *   diperlakukan seolah sudah sah.
 */
export type ImportMode = "aktifkan" | "draft";

/** Ringkasan perubahan terhadap RAB aktif, siap-tampil. */
export type BedaPratinjau = NonNullable<ImportPreview["beda"]>;

export type ImportState = { error?: string; success?: string; preview?: ImportPreview } | undefined;

function safeName(n: string): string {
  return n.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/**
 * Baca template adendum + susun peringatan khas template (DECISIONS 216).
 *
 * Dua hal yang WAJIB disebut di pratinjau karena tidak terlihat di diff biasa:
 * item yang dinyatakan HAPUS (baris hilang bisa juga berarti user lupa), dan
 * item yang volumenya dijadikan 0 (tetap ada, nilainya nol — bukan dihapus).
 */
async function bacaTemplateAdendum(wb: import("exceljs").Workbook) {
  const { parseAdendumTemplate } = await import("@/lib/rab/adendum-template-parse");
  const h = parseAdendumTemplate(wb);
  const warnings: string[] = [];
  const daftar = (xs: { code: string; name: string }[], n = 8) =>
    xs.slice(0, n).map((x) => `${x.code} ${x.name}`).join("; ") +
    (xs.length > n ? `; +${xs.length - n} lainnya` : "");

  if (h.dihapus.length > 0) {
    warnings.push(
      `${h.dihapus.length} item DINYATAKAN DICABUT lewat kolom Keterangan: ${daftar(h.dihapus)}. ` +
        `Item yang sudah punya realisasi akan disebut terpisah di bawah — periksa dulu sebelum melanjutkan.`,
    );
  }
  if (h.volumeNol.length > 0) {
    warnings.push(
      `${h.volumeNol.length} item volumenya dijadikan 0: ${daftar(h.volumeNol)}. ` +
        `Item ini TETAP tercantum di RAB dengan nilai nol — nol bukan penghapusan. ` +
        `Kalau maksudnya mencabut item, tulis HAPUS di kolom Keterangan.`,
    );
  }
  if (h.itemBaru.length > 0) {
    warnings.push(
      `${h.itemBaru.length} item baru disisipkan: ` +
        h.itemBaru.slice(0, 8).map((x) => `${x.code} ${x.name} (${x.kategori})`).join("; ") +
        (h.itemBaru.length > 8 ? `; +${h.itemBaru.length - 8} lainnya` : "") +
        `. Harga item baru dipakai apa adanya — ia memang belum pernah disepakati.`,
    );
  }
  return { ...h, warnings };
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

    // TEMPLATE KERJA ADENDUM terbitan MARLIN punya bentuk sendiri (kolom
    // kontrak dan kolom adendum berdampingan) dan identitas baris yang
    // eksplisit lewat lineageKey — tidak bisa dibaca `hps-parser`, yang menebak
    // struktur dari pola kode. Dikenali dari penanda di sel header, lalu
    // dikonversi ke bentuk `FlatNode[]` YANG SAMA supaya seluruh mesin
    // pratinjau di bawah ini (diff, realisasi lepas, harga bergeser) berlaku
    // apa adanya. DECISIONS 216.
    // Hanya dicoba pada mode draft: template adendum memang cuma dipakai di
    // sana, dan membuka workbook dua kali untuk berkas HPS 4-5 MB itu mahal.
    const mode: ImportMode = formData.get("mode") === "draft" ? "draft" : "aktifkan";
    let templateAdendum: Awaited<ReturnType<typeof bacaTemplateAdendum>> | null = null;
    if (mode === "draft") {
      const ExcelJS = (await import("exceljs")).default;
      const probe = new ExcelJS.Workbook();
      let cocok = false;
      try {
        await probe.xlsx.load(buffer as unknown as ArrayBuffer);
        const { isAdendumTemplate } = await import("@/lib/rab/adendum-template-parse");
        cocok = isAdendumTemplate(probe);
      } catch {
        // Gagal dibuka sebagai workbook → biar jalur HPS yang melaporkannya,
        // dengan pesan galat yang sudah dikenal user.
      }
      if (cocok) {
        // Sudah pasti template: galatnya BUKAN "coba jalur lain", melainkan
        // kesalahan pengisian yang harus disebut apa adanya ke user.
        try {
          templateAdendum = await bacaTemplateAdendum(probe);
        } catch (e) {
          if (e instanceof AdendumTemplateError) return { error: e.message };
          throw e;
        }
      }
    }

    let parsed;
    let warnings: string[];
    let priceColumn;
    let nodes;
    if (templateAdendum) {
      warnings = [...templateAdendum.warnings];
      priceColumn = { label: "TEMPLATE ADENDUM (kolom Volume Adendum)", source: "nego" as const };
      nodes = templateAdendum.nodes;
    } else {
      try {
        ({ parsed, warnings, priceColumn } = await parseHpsBuffer(buffer));
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Gagal membaca file HPS." };
      }
      nodes = flattenParsedRab(parsed);
    }
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

    const draft = await db.rabRevision.findFirst({
      where: { locationId: location.id, status: "draft" },
      select: { id: true, revisionNo: true, totalValue: true, amendmentId: true, note: true },
    });

    // Perbandingan terhadap RAB aktif — supaya "apa yang berubah" terlihat
    // SEBELUM ada yang ditulis, bukan sesudah (DECISIONS 209).
    let beda: RingkasBeda | null = null;
    if (activeRevision) {
      const aktifNodes = await db.rabNode.findMany({
        where: { revisionId: activeRevision.id },
        select: {
          lineageKey: true,
          kind: true,
          code: true,
          name: true,
          volume: true,
          unitPrice: true,
          amount: true,
        },
      });
      beda = bandingkanTerhadapAktif(
        aktifNodes.map((n) => ({
          lineageKey: n.lineageKey,
          kind: n.kind,
          code: n.code,
          name: n.name,
          volume: n.volume == null ? null : Number(n.volume),
          unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
          amount: n.amount,
        })),
        nodes,
        await cumulativeVolumeByLineage(location.id),
      );

      // Harga satuan item KONTRAK LAMA yang bergeser (DECISIONS 213). Adendum
      // mengubah volume; harga item yang sudah disepakati tidak boleh ikut
      // bergerak. Kalau bergerak, nilai kontrak berubah TANPA ada pekerjaan
      // yang bertambah — dan tidak satu pun kolom volume memperlihatkannya.
      if (beda.hargaBerubah.length > 0) {
        const naik = beda.hargaBerubah.filter((h) => h.dampakRupiah > 0n).length;
        const dampak = beda.hargaBerubah.reduce((t, h) => t + h.dampakRupiah, 0n);
        const harga = (v: number | null) => (v == null ? "—" : formatNumber(v));
        const contoh = beda.hargaBerubah
          .slice(0, 5)
          .map((h) => `${h.code} ${h.name} (${harga(h.dari)} → ${harga(h.ke)})`);
        warnings.push(
          `PERHATIAN — harga satuan ${beda.hargaBerubah.length} item KONTRAK LAMA berubah di file ini ` +
            `(${naik} naik, ${beda.hargaBerubah.length - naik} turun; dampak neto ${formatRupiah(dampak)}): ` +
            `${contoh.join("; ")}${beda.hargaBerubah.length > contoh.length ? `; +${beda.hargaBerubah.length - contoh.length} lainnya` : ""}. ` +
            `Adendum mengubah VOLUME — harga satuan item yang sudah ada di kontrak seharusnya tetap. ` +
            `Angka file TIDAK diubah sendiri; pastikan pergeseran ini memang ada dasarnya sebelum melanjutkan.`,
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
      priceColumnLabel: priceColumn.label,
      priceSource: priceColumn.source,
      warnings,
      categories: nodes
        .filter((n) => n.kind === "kategori")
        .map((n) => ({ code: n.code, name: n.name, total: n.amount.toString() })),
      mode,
      draftAda: draft ? { revisionNo: draft.revisionNo, totalValue: draft.totalValue.toString() } : null,
      beda: beda
        ? {
            totalAktif: beda.totalAktif.toString(),
            totalBaru: beda.totalBaru.toString(),
            jumlahTetap: beda.jumlahTetap,
            itemBaru: beda.itemBaru.map((b) => ({ code: b.code, name: b.name })),
            itemHilang: beda.itemHilang.map((b) => ({ code: b.code, name: b.name, realisasi: b.realisasi })),
            volumeBerubah: beda.volumeBerubah.map((b) => ({
              code: b.code,
              name: b.name,
              dari: b.dari,
              ke: b.ke,
              realisasi: b.realisasi,
              dibawahRealisasi: b.dibawahRealisasi,
            })),
            hargaBerubah: beda.hargaBerubah.map((b) => ({
              lineageKey: b.lineageKey,
              code: b.code,
              name: b.name,
              dari: b.dari,
              ke: b.ke,
              dampakRupiah: b.dampakRupiah.toString(),
            })),
          }
        : null,
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

    // ── Commit ──────────────────────────────────────────────────────────────
    const note = String(formData.get("note") ?? "").trim() || null;
    const source = isAdendum || mode === "draft" ? ("adendum" as const) : ("hps_awal" as const);

    // Mode DRAFT: isi draft adendum saja. RAB aktif, progres, kurva-S, dan
    // keuangan tidak tersentuh sedikit pun. Draft yang sudah ada DIGANTI
    // seluruhnya (pilihan user 2026-08-02) — kaitan ke adendum kontrak (CCO)
    // dan catatannya dibawa ikut supaya tidak hilang diam-diam.
    if (mode === "draft") {
      if (!activeRevision) {
        return {
          preview,
          notice:
            "Belum ada RAB aktif di lokasi ini — impor draft adendum butuh RAB aktif sebagai pembanding. Impor sebagai RAB aktif dulu.",
        } as ImportState;
      }
      const amendmentId = draft?.amendmentId ?? null;
      const noteDraft = note ?? draft?.note ?? null;
      if (draft) await discardDraft(draft.id, user.id);
      const resDraft = await createRevisionFromNodes(location.id, nodes, {
        source,
        note: noteDraft,
        userId: user.id,
        amendmentId,
      });
      await arsipkanSumber({
        buffer,
        file,
        sha256,
        location,
        userId: user.id,
        revisionId: resDraft.revisionId,
        revisionNo: resDraft.revisionNo,
        adendum: true,
      });
      await catatJejakImpor({
        location,
        userId: user.id,
        file,
        nodes,
        warnings,
        message: `Draft adendum revisi #${resDraft.revisionNo} terisi (${resDraft.itemCount} item). RAB aktif tidak berubah.`,
      });
      revalidatePath(`/proyek/lokasi/${location.slug}/rab`);
      revalidatePath(`/proyek/lokasi/${location.slug}/rab/adendum`);
      return {
        success:
          `Draft adendum revisi #${resDraft.revisionNo} terisi dari ${file.name} ` +
          `(${resDraft.itemCount} item). RAB aktif dan progres TIDAK berubah — ` +
          `draft ini baru berlaku setelah diaktifkan.` +
          (draft ? ` Isi draft #${draft.revisionNo} sebelumnya diganti.` : ""),
      };
    }

    const res = await createRevisionFromNodes(location.id, nodes, {
      source,
      note,
      userId: user.id,
    });
    /*
     * GERBANG EMPAT MATA (DECISIONS 234) — hanya berlaku bila lokasi SUDAH
     * punya RAB aktif (= ini adendum). HPS awal tidak menggantikan kontrak apa
     * pun, jadi tidak menuntut dua tanda tangan.
     *
     * Revisi yang baru dibuat jelas belum punya persetujuan, jadi impor
     * "langsung aktifkan" untuk adendum PASTI tertahan di sini. Itu BUKAN
     * kegagalan impor: berkasnya sudah terbaca dan tersimpan sebagai draft.
     * Yang tidak terjadi hanyalah aktivasinya — dan itu dikatakan apa adanya,
     * bukan dilaporkan sebagai error yang membuat orang mengunggah ulang.
     */
    try {
      await pastikanBolehAktivasi(res.revisionId);
    } catch (e) {
      if (!(e instanceof PersetujuanError)) throw e;
      revalidatePath(`/proyek/lokasi/${location.slug}`, "layout");
      return {
        success:
          `Revisi #${res.revisionNo} tersimpan sebagai DRAFT (${res.itemCount} item) — belum aktif. ` +
          `Aktivasi adendum butuh persetujuan Program Director DAN satu Area/Project/Site Manager. ` +
          `Buka tab Adendum untuk meminta persetujuan lalu mengaktifkannya.`,
      };
    }
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

    await arsipkanSumber({
      buffer,
      file,
      sha256,
      location,
      userId: user.id,
      revisionId: res.revisionId,
      revisionNo: res.revisionNo,
      adendum: isAdendum,
    });

    await catatJejakImpor({
      location,
      userId: user.id,
      file,
      nodes,
      warnings,
      message:
        `Revisi RAB #${res.revisionNo} (${source === "adendum" ? "adendum" : "HPS awal"}) aktif — ` +
        `${res.itemCount} item.` +
        (baselineError ? ` Kurva-S GAGAL di-regenerate: ${baselineError}` : ""),
    });
    revalidatePath(`/proyek/lokasi/${location.slug}`, "layout");
    revalidatePath("/proyek/lokasi");
    revalidatePath("/pengendalian/progress");
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

/**
 * Catat jejak impor RAB (DECISIONS 254).
 *
 * `warnings` di sini BUKAN hiasan — di dalamnya ada peringatan paling mahal
 * yang dimiliki sistem ini: item ber-realisasi yang hilang dari file baru, dan
 * harga satuan item kontrak lama yang bergeser. Selama ini keduanya cuma tampil
 * di layar pratinjau lalu lenyap begitu halaman ditutup, padahal justru
 * itulah yang perlu dibuka lagi berbulan-bulan kemudian saat ada yang
 * mempertanyakan nilai kontrak. Disimpan sebagai `peringatan` — barisnya tetap
 * masuk, orangnya sudah memutuskan melanjutkan; yang dicatat adalah bahwa ia
 * diberi tahu.
 */
async function catatJejakImpor(a: {
  location: { id: string; packageId: string; package: { orgId: string } | null };
  userId: string;
  file: File;
  nodes: { kind: string }[];
  warnings: string[];
  message: string;
}): Promise<void> {
  const orgId = a.location.package?.orgId;
  if (!orgId) return;
  const items = a.nodes.filter((n) => n.kind === "item").length;
  await catatImpor({
    orgId,
    userId: a.userId,
    locationId: a.location.id,
    packageId: a.location.packageId,
    kind: "rab",
    fileName: a.file.name,
    fileBytes: a.file.size,
    rowsRead: a.nodes.length,
    rowsAccepted: items,
    rowsRejected: 0,
    message: a.message,
    masalah: a.warnings.map((w) => ({ severity: "peringatan" as const, message: w })),
  });
}

/**
 * Arsipkan file sumber ke R2 + catat sebagai Document, lalu tautkan ke revisi.
 * BEST-EFFORT: kegagalan arsip tidak boleh membatalkan revisi yang sudah
 * tersimpan — tapi tetap dicatat ke log server, bukan ditelan diam-diam.
 */
async function arsipkanSumber(a: {
  buffer: Buffer;
  file: File;
  sha256: string;
  location: { id: string; name: string; packageId: string; package: { orgId: string } };
  userId: string;
  revisionId: string;
  revisionNo: number;
  adendum: boolean;
}): Promise<void> {
  if (!isR2Configured()) return;
  try {
    const key = `rab-import/${a.location.id}/${randomUUID()}-${safeName(a.file.name)}`;
    await r2Put(key, a.buffer, a.file.type || XLSX_MIME[0]);
    const doc = await db.document.create({
      data: {
        orgId: a.location.package.orgId,
        packageId: a.location.packageId,
        locationId: a.location.id,
        phase: a.adendum ? "adendum" : "kontrak",
        type: "hps",
        title: `HPS/RAB ${a.adendum ? `adendum (revisi #${a.revisionNo})` : "awal"} — ${a.location.name}`,
        r2Key: key,
        fileName: a.file.name,
        mimeType: a.file.type || XLSX_MIME[0],
        bytes: a.file.size,
        sha256: a.sha256,
        uploadedById: a.userId,
      },
    });
    await db.rabRevision.update({ where: { id: a.revisionId }, data: { sourceDocumentId: doc.id } });
  } catch (e) {
    console.error("[rab-import] arsip R2 gagal (revisi tetap tersimpan):", e);
  }
}
