"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { jakartaDateKey } from "@/lib/format";
import { requireCapability } from "@/lib/auth/session";
import { r2SelfTest, type R2SelfTestStep } from "@/lib/r2";
import { sharpSelfTest } from "@/lib/photos";
import { getBranding, setBranding } from "@/lib/branding";
import { getPhotoStampConfig, setPhotoStampConfig, type PhotoStampConfig } from "@/lib/photo-stamp/config";

export type R2TestState =
  | { ok: boolean; steps: R2SelfTestStep[]; stampSampleDataUri?: string }
  | undefined;

export async function runR2Test(): Promise<R2TestState> {
  const actor = await requireCapability("system.manage");
  // Uji R2 (round-trip) + sharp (pemrosesan gambar) sekaligus: keduanya syarat
  // foto lapangan tersimpan. sharp diuji terpisah supaya jelas bila justru
  // pemrosesan gambar yang gagal (bukan R2) — penyebab umum "foto tak muncul".
  const [r2, sharp] = await Promise.all([r2SelfTest(), sharpSelfTest()]);
  const steps: R2SelfTestStep[] = [
    ...r2.steps,
    { step: "SHARP", ok: sharp.ok, detail: sharp.detail },
  ];
  const result = { ok: r2.ok && sharp.ok, steps, stampSampleDataUri: sharp.sampleDataUri };
  await audit(actor.id, "system.r2_test", "system", null, { ok: result.ok, sharp: sharp.ok });
  return result;
}

// ─────────────────────────────────────────────────────────────
// Branding (nama app + tagline + konteks proyek) — bisa diubah admin
// ─────────────────────────────────────────────────────────────

export type BrandingState =
  | {
      error?: string;
      success?: string;
      values?: { appName: string; tagline: string; projectContext: string; ownerName: string; ownerSubtitle: string; ownerAddress: string };
    }
  | undefined;

/**
 * Isian WAJIB ditolak saat kosong, bukan diam-diam dikembalikan ke bawaan.
 *
 * Dulu semuanya boleh kosong dan `getBranding` menambal dengan default — jadi
 * mengosongkan kolom terlihat "berhasil disimpan" padahal nilainya kembali
 * seperti semula, tanpa satu pun pesan. Sekarang yang wajib menolak dengan
 * alasannya, dan yang opsional benar-benar bisa dikosongkan.
 */
const brandingSchema = z.object({
  appName: z.string().trim().min(1, "Nama aplikasi wajib diisi").max(60, "Nama app maksimal 60 karakter"),
  tagline: z.string().trim().min(1, "Tagline wajib diisi").max(160, "Tagline maksimal 160 karakter"),
  projectContext: z.string().trim().max(160, "Konteks proyek maksimal 160 karakter"),
  ownerName: z
    .string()
    .trim()
    .min(1, "Nama pemilik pekerjaan wajib diisi")
    .max(120, "Nama pemilik pekerjaan maksimal 120 karakter"),
  ownerSubtitle: z.string().trim().max(160, "Keterangan pemilik pekerjaan maksimal 160 karakter"),
  ownerAddress: z.string().trim().max(400, "Alamat & kontak maksimal 400 karakter"),
});

/** Batas & format logo pemilik pekerjaan — sama dengan logo perusahaan. */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export async function saveBranding(_prev: BrandingState, formData: FormData): Promise<BrandingState> {
  const actor = await requireCapability("system.manage");
  const parsed = brandingSchema.safeParse({
    appName: formData.get("appName") ?? "",
    tagline: formData.get("tagline") ?? "",
    projectContext: formData.get("projectContext") ?? "",
    ownerName: formData.get("ownerName") ?? "",
    ownerSubtitle: formData.get("ownerSubtitle") ?? "",
    ownerAddress: formData.get("ownerAddress") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Logo pemilik pekerjaan (opsional). Diperkecil & dinormalisasi ke WebP
  // supaya kop blanko ringan dan formatnya seragam — pola sama dengan logo
  // perusahaan di master vendor.
  let ownerLogoKey: string | undefined;
  const file = formData.get("ownerLogo");
  if (file instanceof File && file.size > 0) {
    const { isR2Configured, r2Put } = await import("@/lib/r2");
    if (!isR2Configured()) return { error: "Penyimpanan berkas (R2) belum dikonfigurasi." };
    if (file.size > LOGO_MAX_BYTES) return { error: "Logo terlalu besar (maks 2 MB)." };
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return { error: "Format logo harus PNG/JPG/WebP." };
    const sharp = (await import("sharp")).default;
    const buf = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "none" })
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    ownerLogoKey = `branding/owner-logo-${Date.now()}.webp`;
    await r2Put(ownerLogoKey, buf, "image/webp");
  }

  // Kosong → pakai default (tetap disimpan sbg string kosong → getBranding fallback).
  await setBranding({ ...parsed.data, ...(ownerLogoKey ? { ownerLogoKey } : {}) });
  await audit(actor.id, "system.branding_update", "system", null, parsed.data);
  const values = await getBranding();
  // Refresh shell + login supaya perubahan langsung tampak.
  revalidatePath("/", "layout");
  return { success: "Branding tersimpan.", values };
}

export type ResetState = { error?: string; success?: string } | undefined;

/**
 * Reset data operasional (laporan, foto, transaksi) — HANYA dev/test, guard ganda:
 * capability system.manage + APP_ENV bukan production + konfirmasi ketik.
 */
export async function resetOperationalData(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const actor = await requireCapability("system.manage");
  if (env.APP_ENV === "production") return { error: "Reset dilarang di production." };
  if (formData.get("confirm") !== "KOSONGKAN") return { error: 'Ketik "KOSONGKAN" untuk konfirmasi.' };

  await db.$transaction([
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_report_status_history" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "photos" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_report_items" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_report_workers" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_report_materials" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_report_equipment" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "daily_reports" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "recovery_updates" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "recovery_actions" CASCADE'),
    db.$executeRawUnsafe('TRUNCATE TABLE "issues" CASCADE'),
  ]);
  await audit(actor.id, "system.reset_operational", "system", null);
  revalidatePath("/");
  return { success: "Data operasional (laporan, foto, kendala) dikosongkan. Master & RAB tetap." };
}

// ── Cap foto (Photo Stamp) ────────────────────────────────────────────────────
export type PhotoStampState = { error?: string; success?: string; values?: PhotoStampConfig } | undefined;

const photoStampSchema = z.object({
  accentColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/, "Warna HEX tidak valid (contoh: #FF8A00)"),
  overlayStrength: z.enum(["auto", "light", "standard", "strong"]),
  size: z.enum(["compact", "standard", "large"]),
  showCoordinates: z.boolean(),
  showReporter: z.boolean(),
  showPhotoId: z.boolean(),
});

export async function savePhotoStampConfigAction(
  _prev: PhotoStampState,
  formData: FormData,
): Promise<PhotoStampState> {
  const actor = await requireCapability("system.manage");
  const parsed = photoStampSchema.safeParse({
    accentColor: formData.get("accentColor") ?? "",
    overlayStrength: formData.get("overlayStrength") ?? "auto",
    size: formData.get("size") ?? "standard",
    showCoordinates: formData.get("showCoordinates") === "on",
    showReporter: formData.get("showReporter") === "on",
    showPhotoId: formData.get("showPhotoId") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await setPhotoStampConfig(parsed.data);
  await audit(actor.id, "system.photo_stamp_update", "system", null, parsed.data);
  return { success: "Pengaturan cap foto tersimpan – berlaku pada foto berikutnya.", values: await getPhotoStampConfig() };
}

// ─── Master data jenis kegiatan lapangan ──────────────────────────────
// Kelola pilihan "Jenis kegiatan" (tabel FieldActivityKind) tanpa developer.
// Key stabil (immutable) supaya data lama tetap tertaut; label & aktif bisa diubah.

export type ActivityKindState = { error?: string; success?: string } | undefined;

const activityKindSchema = z.object({
  key: z.string().trim().optional().default(""),
  label: z.string().trim().min(2, "Nama minimal 2 karakter").max(60, "Nama maksimal 60 karakter"),
  isActive: z.boolean().default(true),
});

function slugifyKind(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "jenis"
  );
}

export async function saveActivityKindAction(_prev: ActivityKindState, formData: FormData): Promise<ActivityKindState> {
  const actor = await requireCapability("system.manage");
  const parsed = activityKindSchema.safeParse({
    key: formData.get("key") ?? "",
    label: formData.get("label") ?? "",
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  if (d.key) {
    const existing = await db.fieldActivityKind.findUnique({ where: { key: d.key } });
    if (!existing) return { error: "Jenis kegiatan tidak ditemukan." };
    await db.fieldActivityKind.update({ where: { key: d.key }, data: { label: d.label, isActive: d.isActive } });
    await audit(actor.id, "system.activity_kind_update", "field_activity_kind", existing.id, {
      key: d.key,
      label: d.label,
      isActive: d.isActive,
    });
    revalidatePath("/sistem");
    return { success: `Jenis "${d.label}" diperbarui.` };
  }

  // Tambah baru: key = slug label, dijamin unik.
  const taken = new Set((await db.fieldActivityKind.findMany({ select: { key: true } })).map((k) => k.key));
  let key = slugifyKind(d.label);
  if (taken.has(key)) {
    let i = 2;
    while (taken.has(`${key}_${i}`)) i++;
    key = `${key}_${i}`;
  }
  const maxOrder = (await db.fieldActivityKind.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  const created = await db.fieldActivityKind.create({
    data: { key, label: d.label, isActive: true, sortOrder: maxOrder + 10 },
  });
  await audit(actor.id, "system.activity_kind_create", "field_activity_kind", created.id, { key, label: d.label });
  revalidatePath("/sistem");
  return { success: `Jenis "${d.label}" ditambahkan.` };
}

/* ── Bangun ulang snapshot laporan harian final ─────────────────────────── */

export type RebuildSnapshotState = { error?: string; success?: string } | undefined;

/**
 * Hitung ulang `finalSnapshot` laporan harian yang sudah final dari data
 * laporan yang SAMA — status, volume, dan input tidak disentuh sama sekali.
 *
 * Perlu karena snapshot dibekukan saat finalisasi: perbaikan rumus (mis.
 * DECISIONS 147, kumulatif tidak dibatasi tanggal) tidak otomatis merambat ke
 * laporan yang terlanjur final. Idempoten & aman diulang. DECISIONS 148.
 */
export async function rebuildFinalSnapshots(
  _prev: RebuildSnapshotState,
  formData: FormData,
): Promise<RebuildSnapshotState> {
  try {
    const actor = await requireCapability("system.manage");
    const scope = z
      .object({ locationId: z.string().trim() })
      .safeParse({ locationId: formData.get("locationId") ?? "" });
    const locationId = scope.success && scope.data.locationId ? scope.data.locationId : null;

    const reports = await db.dailyReport.findMany({
      where: {
        status: "final",
        location: locationId ? { id: locationId, package: { orgId: actor.orgId } } : { package: { orgId: actor.orgId } },
      },
      orderBy: [{ locationId: "asc" }, { reportDate: "asc" }],
      select: { id: true },
    });
    if (reports.length === 0) return { error: "Tidak ada laporan harian berstatus final pada cakupan ini." };

    const { buildFinalSnapshot } = await import("@/lib/daily-report/service");
    let ok = 0;
    let gagal = 0;
    // Berurutan, bukan paralel: menghitung kumulatif per laporan cukup berat
    // dan koreksi ini tidak perlu cepat — yang penting tidak membebani DB.
    for (const r of reports) {
      try {
        const snapshot = await buildFinalSnapshot(r.id);
        await db.dailyReport.update({
          where: { id: r.id },
          data: { finalSnapshot: snapshot as unknown as Prisma.InputJsonValue },
        });
        ok++;
      } catch {
        gagal++;
      }
    }

    await audit(actor.id, "daily_report.snapshot_rebuild", "location", locationId, {
      total: reports.length,
      ok,
      gagal,
    });
    revalidatePath("/", "layout");
    return {
      success:
        `${ok} laporan final dibangun ulang${gagal > 0 ? `, ${gagal} gagal` : ""}. ` +
        "Status & data input tidak berubah – hanya angka pada cetakan yang dihitung ulang.",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}

// ─────────────────────────────────────────────────────────────
// Kebijakan pengendalian (DECISIONS 218)
// ─────────────────────────────────────────────────────────────

export type PolicyState = { error?: string; success?: string } | undefined;

/**
 * Simpan kebijakan pengendalian dari halaman Sistem.
 *
 * Sengaja SATU action untuk semua saklar: kebijakan-kebijakan ini saling
 * berkaitan (mis. menyalakan "pemfinal harus beda" tanpa "penyetuju harus beda"
 * hanya memindahkan lubangnya), jadi user melihat dan menyimpannya sekaligus.
 * Setiap perubahan dicatat audit — kebijakan yang bisa dimatikan diam-diam
 * sama saja dengan tidak ada kebijakan.
 */
export async function savePolicyAction(_prev: PolicyState, formData: FormData): Promise<PolicyState> {
  const actor = await requireCapability("system.manage");
  const { getPolicy, setPolicy } = await import("@/lib/policy");
  const sebelum = await getPolicy();
  const baru = {
    approverMustDiffer: formData.get("approverMustDiffer") === "on",
    finalizerMustDiffer: formData.get("finalizerMustDiffer") === "on",
    requirePhotoGps: formData.get("requirePhotoGps") === "on",
  };
  await setPolicy(baru);
  const berubah = (Object.keys(baru) as (keyof typeof baru)[]).filter((k) => baru[k] !== sebelum[k]);
  await audit(actor.id, "system.policy_update", "system", null, { sebelum, baru, berubah });
  revalidatePath("/sistem");
  return {
    success:
      berubah.length === 0
        ? "Tidak ada perubahan kebijakan."
        : `Kebijakan tersimpan – ${berubah.length} setelan berubah.`,
  };
}

// ─────────────────────────────────────────────────────────────
// Penyimpanan R2: periksa isi bucket, bersihkan yang sampah
// ─────────────────────────────────────────────────────────────

export type AuditR2State =
  | { error: string; hasil?: undefined }
  | { error?: undefined; hasil: import("@/lib/r2-audit").HasilAuditR2 }
  | undefined;

/**
 * Periksa isi bucket dari LAYAR, bukan dari terminal.
 *
 * Teguran user 2026-09-09 atas versi pertama yang berupa skrip: *"sejak kapan
 * harus buka console lalu harus jalankan perintah itu! kalau kamu ngasih solusi
 * yang praktis!"*. Alat pemeliharaan yang menuntut orang membuka terminal
 * produksi bukan alat — ia pekerjaan rumah yang dititipkan.
 */
export async function auditPenyimpananAction(): Promise<AuditR2State> {
  const actor = await requireCapability("system.manage");
  const { isR2Configured } = await import("@/lib/r2");
  if (!isR2Configured()) return { error: "R2 belum dikonfigurasi – tidak ada penyimpanan untuk diperiksa." };
  const { auditR2 } = await import("@/lib/r2-audit");
  try {
    const hasil = await auditR2();
    await audit(actor.id, "system.r2_audit", "system", null, {
      totalObyek: hasil.totalObyek,
      totalBytes: hasil.totalBytes,
      yatimObyek: hasil.yatimObyek,
      yatimBytes: hasil.yatimBytes,
    });
    return { hasil };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gagal membaca isi penyimpanan." };
  }
}

export type BersihkanR2State = { error?: string; success?: string } | undefined;

/**
 * Hapus obyek yatim — daftarnya DIHITUNG ULANG di sini, tidak diterima dari
 * peramban.
 *
 * Versi pertama menerima daftar kunci dari layar. Dua cacat sekaligus: layar
 * hanya memegang 50 yatim terbesar (jadi "hapus 5.000 obyek" diam-diam cuma
 * menghapus 50), dan daftar dari klien bisa basi — foto yang diunggah SESUDAH
 * pemeriksaan akan terbaca yatim oleh layar yang belum tahu. Yang menentukan
 * boleh-tidaknya sebuah obyek dihapus harus keadaan pada DETIK penghapusan,
 * bukan potret beberapa menit lalu.
 *
 * Penghapusan obyek storage tidak bisa dibatalkan dan satu-satunya salinan foto
 * lapangan ber-GPS ada di sana — jadi tiap penghapusan dicatat `audit()`.
 */
export async function bersihkanPenyimpananAction(): Promise<BersihkanR2State> {
  const actor = await requireCapability("system.manage");
  const { isR2Configured, r2Delete } = await import("@/lib/r2");
  if (!isR2Configured()) return { error: "R2 belum dikonfigurasi." };

  const { kunciYatim } = await import("@/lib/r2-audit");
  const yatim = [...(await kunciYatim())];
  if (yatim.length === 0) return { success: "Tidak ada yang perlu dibersihkan." };

  let terhapus = 0;
  const gagal: string[] = [];
  for (const k of yatim) {
    try {
      await r2Delete(k);
      terhapus++;
    } catch {
      gagal.push(k);
    }
  }
  await audit(actor.id, "system.r2_cleanup", "system", null, {
    yatimSaatItu: yatim.length,
    terhapus,
    gagal: gagal.length,
    contohGagal: gagal.slice(0, 20),
  });
  revalidatePath("/sistem");
  return {
    success:
      `${terhapus} obyek yatim dihapus` +
      (gagal.length > 0 ? ` \u00b7 ${gagal.length} gagal dihapus (coba lagi nanti).` : "."),
  };
}

// ─────────────────────────────────────────────────────────────
// Arsip dingin berkas asli foto
// ─────────────────────────────────────────────────────────────

export type ArsipAsliState = { error?: string; success?: string } | undefined;

/**
 * Nyalakan/matikan pemindahan berkas asli, dan atur masa tenggangnya.
 *
 * Ada di LAYAR, bukan di variabel lingkungan. Teguran user 2026-09-09 atas
 * rancangan bervariabel 14: sakelar hidup/mati justru yang paling sering perlu
 * diubah — saat mesin arsipnya mati, saat mencoba pertama kali — sementara
 * mengubah variabel lingkungan berarti deploy ulang dan menunggu.
 */
export async function setArsipAsliAction(
  _prev: ArsipAsliState,
  formData: FormData,
): Promise<ArsipAsliState> {
  const actor = await requireCapability("system.manage");
  const aktif = formData.get("aktif") === "on";
  const tenggangRaw = Number(formData.get("tenggang") ?? "");
  const { arsipAktif, tenggangHari, setArsipAktif, setTenggangHari } = await import(
    "@/lib/arsip-asli/setelan"
  );
  const sebelum = { aktif: await arsipAktif(), tenggang: await tenggangHari() };

  if (!Number.isFinite(tenggangRaw) || tenggangRaw < 0 || tenggangRaw > 365) {
    return { error: "Masa tenggang harus 0–365 hari." };
  }
  await setArsipAktif(aktif);
  await setTenggangHari(tenggangRaw);
  await audit(actor.id, "system.arsip_asli", "system", null, {
    sebelum,
    sesudah: { aktif, tenggang: Math.floor(tenggangRaw) },
  });
  revalidatePath("/sistem");
  return {
    success: aktif
      ? `Arsip dingin AKTIF – salinan R2 dibuang ${Math.floor(tenggangRaw)} hari setelah berkasnya terbukti aman di sana.`
      : "Arsip dingin dimatikan. Berkas asli tetap di R2, tidak ada yang dipindahkan.",
  };
}

/**
 * UJI SAMBUNGAN KE ARSIP DINGIN — bolak-balik sungguhan, bukan sekadar ping.
 *
 * Pertanyaan "sudah tersambung belum?" tidak bisa dijawab oleh satu permintaan
 * `GET /sehat`: halaman login Cloudflare Access menjawab 200, tunnel yang
 * menyambung ke port kosong menjawab 502, dan penerima yang salah tafsir
 * protokolnya menjawab 200 untuk semuanya. Yang benar-benar menjawabnya cuma
 * satu perjalanan penuh — kirim, baca ulang, ambil kembali, cocokkan byte,
 * hapus — persis langkah yang nanti dipakai berkas asli sungguhan.
 *
 * Berkas ujinya kecil, bernama sendiri di ruang `photos/uji-sambungan/`, dan
 * DIHAPUS di langkah terakhir. Tidak menyentuh basis data, tidak menyentuh satu
 * pun foto.
 *
 * Dijalankan DARI APLIKASI, bukan dari laptop siapa pun: yang perlu dibuktikan
 * adalah Railway bisa menghubungi mesin itu — jaringan lain tidak menjawab
 * pertanyaan itu.
 */
export async function ujiArsipAsliAction(): Promise<ArsipAsliState> {
  const actor = await requireCapability("system.manage");
  const { createHash, randomUUID } = await import("node:crypto");
  const { setelanDingin, periksaDingin, kirimDingin, ambilDingin, hapusDingin, sehatDingin } =
    await import("@/lib/arsip-asli/dingin");

  let setelan;
  try {
    setelan = setelanDingin();
  } catch (err) {
    // Satu-satunya yang dilempar setelanDingin: URL bukan https.
    return { error: err instanceof Error ? err.message : "Setelan arsip tidak sah." };
  }
  if (!setelan) {
    return { error: "ORIGINAL_ARCHIVE_URL / ORIGINAL_ARCHIVE_TOKEN belum diisi di Railway." };
  }

  const kunci = `photos/uji-sambungan/${jakartaDateKey(new Date())}/${randomUUID()}.uji`;
  const isi = Buffer.from(`MARLIN uji sambungan ${new Date().toISOString()}\n`);
  const sha = createHash("sha256").update(isi).digest("hex");
  const jejak: string[] = [];
  let langkah = "menghubungi";

  try {
    /*
     * LANGKAH NOL — KENALI DULU SIAPA YANG MENJAWAB.
     *
     * Uji pertama (2026-09-10) langsung mulai dari PUT dan menjawab "404 =
     * yang menjawab bukan penerima arsip". Betul, tapi tidak cukup: user tetap
     * harus menebak apakah itu Cloudflare, cloudflared tanpa servis, atau
     * program lain. Tebakan di langkah ini mahal — yang salah satunya berarti
     * membongkar Tunnel yang sebenarnya sudah benar.
     *
     * `/health` dijawab gateway arsip TANPA token, justru supaya bisa dipakai
     * begini. Yang lain akan menjawab hal lain, dan hal lain itulah yang
     * dilaporkan apa adanya: status, header `server`, dan sepotong badannya.
     */
    langkah = "mengenali yang menjawab (/health)";
    const siapa = await kenaliPenerima(() => sehatDingin(setelan));
    if (!siapa.gatewayArsip) {
      return {
        error:
          `Yang menjawab di ${setelan.url} BUKAN gateway arsip – ${siapa.keterangan} ` +
          "Langkah pemasangannya di docs/ARSIP_DINGIN_SETUP.md.",
      };
    }
    jejak.push("gateway arsip ✓");

    langkah = "kirim (PUT)";
    await kirimDingin(setelan, kunci, isi);
    jejak.push("kirim ✓");

    langkah = "baca ulang (HEAD)";
    const cek = await periksaDingin(setelan, kunci);
    if (!cek.ada) throw new Error("terkirim tapi tidak terbaca kembali");
    if (cek.sha256 && cek.sha256 !== sha) throw new Error("sidik jari di sana berbeda");
    if (cek.bytes != null && cek.bytes !== isi.length) {
      throw new Error(`ukuran di sana ${cek.bytes}, seharusnya ${isi.length}`);
    }
    jejak.push(cek.sha256 ? "baca ulang ✓ (sidik jari cocok)" : "baca ulang ✓");

    langkah = "ambil kembali (GET)";
    const kembali = await ambilDingin(setelan, kunci);
    if (!kembali.equals(isi)) throw new Error("byte yang kembali berbeda dengan yang dikirim");
    jejak.push("ambil kembali ✓");

    langkah = "hapus (DELETE)";
    await hapusDingin(setelan, kunci, sha);
    const sesudah = await periksaDingin(setelan, kunci);
    if (sesudah.ada) throw new Error("dihapus tapi masih ada di sana");
    jejak.push("hapus ✓");

    await audit(actor.id, "system.arsip_asli_uji", "system", null, { hasil: "berhasil" });
    return {
      success: `Tersambung. ${jejak.join(" · ")} – berkas asli aman dipindahkan ke sini.`,
    };
  } catch (err) {
    const pesan = err instanceof Error ? err.message : "gagal";
    // Sisa uji tidak boleh meninggalkan sampah di sana kalau PUT-nya sempat lolos.
    if (jejak.length > 0) await hapusDingin(setelan, kunci, sha).catch(() => {});
    await audit(actor.id, "system.arsip_asli_uji", "system", null, { hasil: "gagal", langkah, pesan });
    const sudah = jejak.length > 0 ? `${jejak.join(" · ")} · ` : "";
    return { error: `${sudah}GAGAL di langkah ${langkah}: ${pesan}. ${dugaan(pesan)}` };
  }
}

/**
 * Siapa yang sebenarnya menjawab di alamat itu?
 *
 * Tanpa token: `/sehat` memang dibuat begitu. Yang dicari cuma satu penanda —
 * badan `{"siap":true}` dari `arsip-dingin/server.mjs`. Selain itu dilaporkan
 * apa adanya, karena tiap penjawab punya sidik yang khas dan itu yang
 * membedakan "Tunnel salah tujuan" dari "program di sana bukan yang ini":
 *
 *   cloudflared tanpa servis   → 404, tanpa header `server`
 *   Cloudflare menghadang      → 403/1033, `server: cloudflare`
 *   Access menuntut login      → 302 ke halaman login (fetch mengikutinya → HTML)
 *   program lain               → apa saja, tapi bukan {"siap":true}
 */
async function kenaliPenerima(
  ketuk: () => Promise<Response>,
): Promise<{ gatewayArsip: boolean; keterangan: string }> {
  let res: Response;
  try {
    res = await ketuk();
  } catch (err) {
    const p = err instanceof Error ? err.message : "gagal";
    return { gatewayArsip: false, keterangan: `tidak dijawab sama sekali (${p}).` };
  }

  const badan = (await res.text().catch(() => "")).slice(0, 160).replace(/\s+/g, " ").trim();
  if (res.ok && /"ok"\s*:\s*true/.test(badan)) return { gatewayArsip: true, keterangan: "" };

  const server = res.headers.get("server");
  const cf = server?.toLowerCase().includes("cloudflare");
  const petunjuk = !server
    ? "tidak ada header `server`, ciri khas cloudflared yang tidak menemukan servis di port tujuannya: periksa `systemctl status marlin-arsip` dan bagian ingress di config.yml."
    : cf && /<html/i.test(badan)
      ? "Cloudflare yang menjawab, bukan mesinmu. Kalau ORIGINAL_ARCHIVE_CF_CLIENT_ID + _SECRET sudah diisi, berarti Service Token itu belum masuk policy aplikasinya: policy-nya harus Action = Service Auth dengan token itu di daftar Include."
      : "ada program lain di sana yang bukan gateway arsip.";

  return {
    gatewayArsip: false,
    keterangan: `status ${res.status}${server ? `, server: ${server}` : ""}${badan ? `, jawabannya: "${badan}"` : ""}. ${petunjuk}`,
  };
}

/**
 * Terjemahan galat mentah ke kalimat yang bisa ditindaklanjuti.
 *
 * Angka status HTTP sendirian tidak memberi tahu siapa pun apa yang harus
 * diperbaiki, dan yang membaca layar ini sedang memasang mesin — bukan membaca
 * spesifikasi HTTP.
 */
function dugaan(pesan: string): string {
  // 401 dan 403 datang dari DUA lapis berbeda, dan bedanya yang menentukan mana
  // yang harus diperbaiki: Access menjaga pintu gedung, bearer menjaga pintu kamar.
  if (/\b401\b/.test(pesan)) {
    return "401 = ditolak gateway-nya sendiri: ORIGINAL_ARCHIVE_TOKEN berbeda dengan STORAGE_TOKEN di /opt/marlin-original-storage/.env.";
  }
  if (/\b403\b/.test(pesan)) {
    return "403 = ditolak Cloudflare Access sebelum sampai ke mesinnya. Isi ORIGINAL_ARCHIVE_CF_CLIENT_ID + _SECRET dengan Service Token, dan pastikan policy-nya Service Auth.";
  }
  if (/\b404\b/.test(pesan)) {
    return "404 = alamatnya sampai, tapi yang menjawab bukan gateway arsip. Periksa route Tunnel-nya menunjuk ke http://localhost:3100.";
  }
  if (/\b(400|422)\b/.test(pesan)) {
    return "Gateway menolak permintaannya – kemungkinan versinya lebih tua daripada yang diharapkan MARLIN.";
  }
  if (/\b413\b/.test(pesan)) return "413 = berkasnya melewati MAX_BYTES di gateway.";
  if (/\b(502|503|530)\b/.test(pesan)) {
    return "Tunnel-nya hidup tapi tidak menemukan servisnya – `systemctl status marlin-arsip` di mesin itu.";
  }
  if (/\b(507|509)\b/.test(pesan)) {
    return "Disk arsipnya penuh, atau sisanya sudah di bawah MIN_FREE_BYTES.";
  }
  if (/\b409\b/.test(pesan)) return "409 = di sana sudah ada berkas lain dengan kunci sama.";
  if (/timed? ?out|abort|ETIMEDOUT/i.test(pesan)) {
    return "Tidak dijawab sampai batas waktu – mesinnya mati, Tunnel-nya mati, atau uplink-nya tersendat.";
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(pesan)) return "Nama domainnya tidak terpetakan.";
  return "Cek `systemctl status marlin-arsip` dan log cloudflared di mesin itu.";
}

/** Jalankan satu putaran dari layar, tanpa menunggu jadwal cron. */
export async function jalankanArsipAsliAction(): Promise<ArsipAsliState> {
  const actor = await requireCapability("system.manage");
  const { jalankanArsipAsli } = await import("@/lib/arsip-asli/antrean");
  try {
    const h = await jalankanArsipAsli();
    await audit(actor.id, "system.arsip_asli_run", "system", null, h);
    revalidatePath("/sistem");
    if (!h.dijalankan) {
      const sebab: Record<string, string> = {
        mati: "Sakelarnya masih mati.",
        "belum-dikonfigurasi": "ORIGINAL_ARCHIVE_URL / _TOKEN belum diisi di Railway.",
        "r2-mati": "R2 belum dikonfigurasi.",
      };
      return { error: sebab[h.alasan] ?? "Tidak dijalankan." };
    }
    return {
      success:
        `${h.dikirim} berkas asli dipindahkan ke arsip dingin · ${h.dibuangDariR2} salinan R2 dibuang` +
        (h.gagal > 0 ? ` · ${h.gagal} gagal (${h.galat.slice(0, 2).join("; ")})` : "."),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Putaran arsip gagal." };
  }
}
