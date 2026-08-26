"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, accessibleLocationIds, requireCapability } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { transisiSurat } from "./lifecycle";
import { buatSurat } from "./lampiran-actions";
import type { LetterStatus } from "@/generated/prisma/enums";

/**
 * Aksi register surat (DECISIONS 432) — tahap 1–4:
 * 1. catat surat manual (yang tidak lewat grup WA)
 * 2. kaitkan ke paket/lokasi (lewat form)
 * 3. utang jawab: tandai dijawab + rantai balasan
 * 4. petakan surat menjadi kendala / temuan, dengan sumber TEGAS `surat`
 *    supaya asalnya terbaca di papan (pola DECISIONS 392).
 */

export type SuratState = { error?: string; success?: string } | undefined;

function fail(err: unknown): SuratState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const tanggal = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid");

const catatSchema = z.object({
  packageId: z.uuid().optional().or(z.literal("")),
  // Surat bisa merujuk LANGSUNG ke satu lokasi tanpa lewat paket, atau ke
  // keduanya, atau tidak sama sekali (ketetapan user 2026-08-26). Karena itu
  // keduanya berdiri sendiri — bukan lokasi yang diturunkan dari paket.
  locationId: z.uuid().optional().or(z.literal("")),
  direction: z.enum(["masuk", "keluar"]),
  party: z.enum(["penyedia", "wakil_ppk", "ppk", "konsultan", "dinas", "internal", "lainnya"]),
  partyName: z.string().trim().max(150).optional(),
  subject: z.string().trim().min(3, "Perihal minimal 3 karakter").max(300),
  summary: z.string().trim().max(4000).optional(),
  letterNumber: z.string().trim().max(120).optional(),
  letterDate: tanggal.optional().or(z.literal("")),
  handledDate: tanggal,
  category: z.enum(["mutu", "jadwal", "pembayaran", "administrasi", "koordinasi", "k3", "lainnya"]),
  needsReply: z.enum(["ya", "tidak"]),
  replyDueDate: tanggal.optional().or(z.literal("")),
  inReplyToId: z.uuid().optional().or(z.literal("")),
});

/** Catat surat langsung di register (bukan dari lampiran WA). */
export async function catatSuratAction(_prev: SuratState, formData: FormData): Promise<SuratState> {
  try {
    const user = await requireCapability("letter.manage");
    const parsed = catatSchema.safeParse({
      packageId: formData.get("packageId") ?? "",
      locationId: formData.get("locationId") ?? "",
      direction: formData.get("direction"),
      party: formData.get("party"),
      partyName: formData.get("partyName") ?? undefined,
      subject: formData.get("subject"),
      summary: formData.get("summary") ?? undefined,
      letterNumber: formData.get("letterNumber") ?? undefined,
      letterDate: formData.get("letterDate") ?? "",
      handledDate: formData.get("handledDate"),
      category: formData.get("category"),
      needsReply: formData.get("needsReply") ?? "tidak",
      replyDueDate: formData.get("replyDueDate") ?? "",
      inReplyToId: formData.get("inReplyToId") ?? "",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    // Paket & lokasi diperiksa TERPISAH terhadap scope user.
    const izin = await accessibleLocationIds(user);
    if (d.packageId) {
      const scope = packageScopeWhere(user, izin);
      const pkg = await db.package.findFirst({ where: { AND: [{ id: d.packageId }, scope] }, select: { id: true } });
      if (!pkg) return { error: "Paket tidak ditemukan dalam scope Anda." };
    }
    if (d.locationId) {
      const lok = await db.location.findFirst({
        where: { id: d.locationId, ...(izin ? { id: { in: izin } } : {}) },
        select: { id: true },
      });
      if (!lok) return { error: "Lokasi tidak ditemukan dalam scope Anda." };
    }

    /*
     * Berkas surat diarsipkan LANGSUNG ke R2 di sini — beda dari lampiran WA
     * yang menunggu konfirmasi. Alasannya: mencatat surat ITU SENDIRI adalah
     * konfirmasinya. Bila R2 belum siap, suratnya tetap tercatat tanpa berkas
     * dan itu DIKATAKAN, bukan gagal diam-diam.
     */
    let fileR2Key: string | null = null;
    let fileName: string | null = null;
    let fileMime: string | null = null;
    let catatanBerkas = "";
    const berkas = formData.get("file");
    if (berkas instanceof File && berkas.size > 0) {
      const { isR2Configured, r2Put } = await import("@/lib/r2");
      if (!isR2Configured()) {
        catatanBerkas = " Berkas tidak diarsipkan – R2 belum dikonfigurasi (Sistem).";
      } else {
        try {
          const { createHash } = await import("node:crypto");
          const buf = Buffer.from(await berkas.arrayBuffer());
          const sha = createHash("sha256").update(buf).digest("hex");
          const key = `surat/${sha}`;
          await r2Put(key, buf, berkas.type || "application/octet-stream");
          fileR2Key = key;
          fileName = berkas.name;
          fileMime = berkas.type || null;
        } catch {
          catatanBerkas = " Berkas gagal diarsipkan – suratnya tetap tercatat.";
        }
      }
    }

    const needsReply = d.needsReply === "ya";
    const surat = await buatSurat({
      orgId: user.orgId,
      createdById: user.id,
      packageId: d.packageId || null,
      locationId: d.locationId || null,
      direction: d.direction,
      party: d.party,
      partyName: d.partyName || null,
      subject: d.subject,
      summary: d.summary || null,
      letterNumber: d.letterNumber || null,
      letterDate: d.letterDate ? new Date(`${d.letterDate}T00:00:00.000Z`) : null,
      handledDate: new Date(`${d.handledDate}T00:00:00.000Z`),
      category: d.category,
      needsReply,
      replyDueDate: needsReply && d.replyDueDate ? new Date(`${d.replyDueDate}T00:00:00.000Z`) : null,
      fileR2Key,
      fileName,
      fileMime,
    });

    // Surat keluar yang menjawab surat masuk: rantainya ditutup sekalian,
    // supaya "sudah dijawab" tidak perlu diketuk dua kali.
    if (d.inReplyToId) {
      const asal = await db.letter.findFirst({
        where: { id: d.inReplyToId, orgId: user.orgId },
        select: { id: true, status: true },
      });
      if (asal) {
        await db.letter.update({ where: { id: surat.id }, data: { inReplyToId: asal.id } });
        const gate = transisiSurat(asal.status as LetterStatus, "dijawab");
        if (gate.ok) {
          await db.letter.update({
            where: { id: asal.id },
            data: { status: "dijawab", repliedAt: new Date() },
          });
        }
      }
    }

    await audit(user.id, "surat.catat", "package", d.packageId || null, {
      letterId: surat.id,
      agenda: `${surat.agendaNo}/${surat.agendaYear}`,
      direction: d.direction,
      needsReply,
    });
    revalidatePath("/surat");
    return {
      success: `Surat tercatat – agenda ${surat.agendaNo}/${surat.agendaYear}.${catatanBerkas}`,
    };
  } catch (err) {
    return fail(err);
  }
}

/* ── Utang jawab (tahap 3) ──────────────────────────────────────────────── */

const statusSchema = z.object({
  letterId: z.uuid(),
  status: z.enum(["baru", "perlu_jawaban", "dijawab", "selesai", "arsip"]),
});

export async function ubahStatusSuratAction(_prev: SuratState, formData: FormData): Promise<SuratState> {
  try {
    const user = await requireCapability("letter.manage");
    const parsed = statusSchema.safeParse({
      letterId: formData.get("letterId"),
      status: formData.get("status"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const surat = await db.letter.findFirst({
      where: { id: parsed.data.letterId, orgId: user.orgId },
      select: { id: true, status: true, packageId: true },
    });
    if (!surat) return { error: "Surat tidak ditemukan." };

    const gate = transisiSurat(surat.status as LetterStatus, parsed.data.status);
    if (!gate.ok) return { error: gate.error };

    await db.letter.update({
      where: { id: surat.id },
      data: {
        status: gate.status,
        ...(gate.status === "dijawab" ? { repliedAt: new Date() } : {}),
      },
    });
    await audit(user.id, "surat.ubah_status", "package", surat.packageId, {
      letterId: surat.id,
      dari: surat.status,
      ke: gate.status,
    });
    revalidatePath("/surat");
    revalidatePath("/perlu-tindakan");
    return { success: "Status surat diperbarui." };
  } catch (err) {
    return fail(err);
  }
}

/* ── Surat menjadi kendala / temuan (tahap 4) ───────────────────────────── */

const petakanSchema = z.object({
  letterId: z.uuid(),
  jadi: z.enum(["kendala", "temuan"]),
  locationId: z.uuid("Pilih lokasi"),
  judul: z.string().trim().min(5, "Judul minimal 5 karakter").max(200),
  severity: z.enum(["rendah", "sedang", "tinggi"]).optional(),
});

/**
 * Buat kendala atau temuan DARI surat. Sumbernya ditulis tegas (`surat`) dan
 * suratnya ditautkan, sehingga papan terpusat tetap satu pintu dan bukti
 * asalnya bisa dibuka kembali — pola DECISIONS 392/426.
 */
export async function petakanSuratAction(_prev: SuratState, formData: FormData): Promise<SuratState> {
  try {
    const user = await requireCapability("letter.manage");
    const parsed = petakanSchema.safeParse({
      letterId: formData.get("letterId"),
      jadi: formData.get("jadi"),
      locationId: formData.get("locationId"),
      judul: formData.get("judul"),
      severity: formData.get("severity") ?? undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const surat = await db.letter.findFirst({
      where: { id: d.letterId, orgId: user.orgId },
      select: { id: true, subject: true, summary: true, category: true, handledDate: true, packageId: true },
    });
    if (!surat) return { error: "Surat tidak ditemukan." };

    const izin = await accessibleLocationIds(user);
    const lokasi = await db.location.findFirst({
      where: { id: d.locationId, ...(izin ? { id: { in: izin } } : {}) },
      select: { id: true },
    });
    if (!lokasi) return { error: "Lokasi tidak ditemukan dalam scope Anda." };

    const keterangan = [surat.summary?.trim(), `Sumber: surat "${surat.subject}"`]
      .filter(Boolean)
      .join("\n\n");

    if (d.jadi === "kendala") {
      const issue = await db.issue.create({
        data: {
          locationId: lokasi.id,
          title: d.judul,
          description: keterangan,
          severity: d.severity ?? "sedang",
          source: "surat",
          letterId: surat.id,
          raisedById: user.id,
        },
        select: { id: true },
      });
      await audit(user.id, "surat.jadi_kendala", "location", lokasi.id, {
        letterId: surat.id,
        issueId: issue.id,
      });
      revalidatePath("/kendala");
    } else {
      const finding = await db.finding.create({
        data: {
          locationId: lokasi.id,
          source: "surat",
          letterId: surat.id,
          category: kategoriTemuanDari(surat.category),
          severity: d.severity ?? "sedang",
          title: d.judul,
          description: keterangan,
          findingDate: surat.handledDate,
          raisedById: user.id,
        },
        select: { id: true },
      });
      await audit(user.id, "surat.jadi_temuan", "location", lokasi.id, {
        letterId: surat.id,
        findingId: finding.id,
      });
      revalidatePath("/temuan");
    }
    revalidatePath("/surat");
    return {
      success: d.jadi === "kendala" ? "Kendala dibuat dari surat ini." : "Temuan dibuat dari surat ini.",
    };
  } catch (err) {
    return fail(err);
  }
}

/** Perihal surat → kategori temuan. Yang tidak punya padanan jatuh ke lainnya. */
function kategoriTemuanDari(k: string): "mutu" | "volume" | "k3" | "administrasi" | "jadwal" | "lingkungan" | "lainnya" {
  switch (k) {
    case "mutu":
      return "mutu";
    case "jadwal":
      return "jadwal";
    case "k3":
      return "k3";
    case "pembayaran":
    case "administrasi":
      return "administrasi";
    default:
      return "lainnya";
  }
}

/* ── Unggah berkas surat + pemetaan AI SEKALI JALAN (DECISIONS 434) ──────── */

export type BacaSuratState =
  | { error?: string; hasil?: undefined }
  | {
      error?: undefined;
      /** Semua isian formulir hasil satu panggilan AI. */
      hasil: {
        nomor: string | null;
        tanggal: string | null;
        pihak: string;
        namaPihak: string | null;
        arah: string;
        perihal: string | null;
        kategori: string;
        butuhJawaban: boolean;
        tenggat: string | null;
        ringkasan: string | null;
        potensi: string;
        alasanPotensi: string | null;
        /** Hasil pencocokan sebutan surat ke data — null bila tidak yakin. */
        packageId: string | null;
        packageNama: string | null;
        locationId: string | null;
        locationNama: string | null;
        /** Apa yang disebut surat, ditampilkan walau tidak cocok ke data. */
        lokasiSebutan: string | null;
        paketSebutan: string | null;
      };
      catatan?: string;
    }
  | undefined;

/** Batas berkas yang dikirim ke AI — melindungi dari PDF ratusan halaman. */
const BATAS_BACA_BYTE = 20 * 1024 * 1024;

/**
 * Baca berkas surat dan petakan SELURUH isinya dalam SATU permintaan AI.
 *
 * Ketetapan user 2026-08-26: *"sekali kirim kamu seharusnya petakan semua via
 * AI... sekali request saja."* Jadi nomor, tanggal, pihak, perihal, kategori,
 * tuntutan jawaban, ringkasan maksud, dugaan potensi kendala/temuan, sampai
 * lokasi & paket yang disebut — semuanya dari satu panggilan.
 *
 * Hasilnya HANYA mengisi formulir. Tidak ada yang tersimpan di sini; orang
 * memeriksa lalu menekan simpan. Berkasnya sendiri diarsipkan saat surat
 * disimpan, bukan saat dibaca — membaca bukan tanda berkas itu berguna.
 */
export async function bacaBerkasSuratAction(
  _prev: BacaSuratState,
  formData: FormData,
): Promise<BacaSuratState> {
  try {
    const user = await requireCapability("letter.manage");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Pilih berkas suratnya dulu." };
    }
    if (file.size > BATAS_BACA_BYTE) {
      return { error: `Berkas ${Math.round(file.size / 1024 / 1024)} MB terlalu besar untuk dibaca AI.` };
    }

    const { getActiveAiConfig } = await import("@/lib/ai/config");
    const cfg = await getActiveAiConfig();
    if (!cfg) return { error: "Provider AI belum siap – atur di Sistem → AI, atau isi formulirnya sendiri." };

    const mime = file.type || "application/octet-stream";
    const { dukunganLampiran } = await import("@/lib/ai/client");
    const dukung = dukunganLampiran(cfg.apiStyle);
    const pdf = mime === "application/pdf";
    if (pdf && !dukung.pdf) return { error: dukung.alasan };
    if (!pdf && !mime.startsWith("image/")) {
      return {
        error: "Hanya PDF dan gambar yang bisa dibaca AI. Untuk berkas lain, isi formulirnya sendiri.",
      };
    }

    const { aiCall } = await import("@/lib/ai/client");
    const { promptDefault } = await import("@/lib/ai/prompt-registry");
    const { resolvePrompt } = await import("@/lib/ai/prompts");
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const r = await aiCall({
      system: (await resolvePrompt("surat.baca")) || promptDefault("surat.baca"),
      prompt:
        `Berkas: ${file.name}\n` +
        "Petakan isi surat ini ke medan-medan yang diminta. Jawab hanya baris berlabel.",
      attachments: [{ mediaType: mime, dataBase64: b64 }],
      maxTokens: 900,
      timeoutMs: 120_000,
    });
    if (!r.ok) return { error: r.error };

    const { bacaHasilSurat, cocokkanSebutan } = await import("./baca-hasil");
    const h = bacaHasilSurat(r.text);

    // Cocokkan sebutan surat ke data yang benar-benar ada, dalam scope user.
    const izin = await accessibleLocationIds(user);
    const [paketList, lokasiList] = await Promise.all([
      db.package.findMany({
        where: izin ? { locations: { some: { id: { in: izin } } } } : { orgId: user.orgId },
        select: { id: true, name: true },
      }),
      db.location.findMany({
        where: izin ? { id: { in: izin } } : { package: { orgId: user.orgId } },
        select: { id: true, name: true },
      }),
    ]);
    const paket = cocokkanSebutan(h.paketSebutan, paketList);
    const lokasi = cocokkanSebutan(h.lokasiSebutan, lokasiList);

    await audit(user.id, "surat.baca_berkas_ai", "app_setting", null, {
      fileName: file.name,
      provider: r.provider,
      potensi: h.potensi,
    });

    /*
     * Sebutan yang TIDAK cocok tetap dikembalikan supaya terlihat di layar.
     * Menelannya diam-diam membuat orang mengira surat itu tidak menyebut
     * lokasi apa pun, padahal sebenarnya sistem yang tidak mengenalinya.
     */
    const tidakCocok: string[] = [];
    if (h.lokasiSebutan && !lokasi) tidakCocok.push(`lokasi "${h.lokasiSebutan}"`);
    if (h.paketSebutan && !paket) tidakCocok.push(`paket "${h.paketSebutan}"`);

    return {
      hasil: {
        nomor: h.nomor,
        tanggal: h.tanggal,
        pihak: h.pihak,
        namaPihak: h.namaPihak,
        arah: h.arah,
        perihal: h.perihal,
        kategori: h.kategori,
        butuhJawaban: h.butuhJawaban,
        tenggat: h.tenggat,
        ringkasan: h.ringkasan,
        potensi: h.potensi,
        alasanPotensi: h.alasanPotensi,
        packageId: paket?.id ?? null,
        packageNama: paket?.name ?? null,
        locationId: lokasi?.id ?? null,
        locationNama: lokasi?.name ?? null,
        lokasiSebutan: h.lokasiSebutan,
        paketSebutan: h.paketSebutan,
      },
      catatan: tidakCocok.length
        ? `Surat menyebut ${tidakCocok.join(" dan ")}, tapi tidak cocok dengan data – pilih sendiri bila perlu.`
        : undefined,
    };
  } catch (err) {
    return fail(err) as BacaSuratState;
  }
}
