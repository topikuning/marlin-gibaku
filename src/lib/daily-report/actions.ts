"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  ForbiddenError,
  requireCapability,
  requireLocationAccess,
  requireUser,
  type SessionUser,
} from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { jakartaDateKey } from "@/lib/format";
import { MAX_PHOTOS_PER_UPLOAD, PhotoError, savePhotoForItem } from "@/lib/photos";
import { isR2Configured, r2Delete } from "@/lib/r2";
import { audit, auditIn } from "@/lib/audit";
import { applyWeatherToReport, WeatherError, WeatherFetchError } from "@/lib/weather/service";
import type { UserRole, WeatherCode, WorkerRole } from "@/generated/prisma/enums";
import { WEATHER_ORDER, WORKER_ROLE_ORDER } from "./constants";
import { bacaKendalaKirim } from "./kirim-kendala";
import { ALASAN_NIHIL, judulKendalaDariNihil } from "./nihil";
import {
  addIssueFromReport,
  setHariNihil,
  approveReport,
  CREATOR_ENRICHABLE_STATUSES,
  DailyReportError,
  EDITABLE_STATUSES,
  finalizeReport,
  unfinalizeReport,
  getOrCreateDraft,
  removeItem,
  returnReport,
  setEnrichment,
  submitReport,
  upsertItem,
} from "./service";

/**
 * Server actions laporan harian — boundary FormData + zod v4.
 * Otorisasi di SINI (requireCapability + requireLocationAccess);
 * logika bisnis + transisi di service.ts. Identitas SELALU dari sesi,
 * tidak pernah dari input client.
 */

export type DailyActionState =
  | {
      error?: string;
      success?: string;
      warning?: string;
      /**
       * Kendala TERBUKA yang mirip – tawaran, bukan kegagalan (DECISIONS 407).
       *
       * Menggantikan `usulKendala` lama (DECISIONS 396), yang justru menjadi
       * PINTU KEDUA untuk mencatat kendala hari yang sama: satu di panel hari
       * nihil, satu lagi di lembar kirim. Sekarang pertanyaannya cuma ada di
       * lembar kirim, dan sisa pekerjaan di sini adalah menahan kembarnya.
       */
      kendalaDuplikat?: { id: string; title: string };
      /** Isian yang sudah diketik – dikembalikan supaya tidak perlu diketik ulang. */
      kendalaNilai?: { title: string; description: string; severity: string };
      /**
       * Hasil pindah tanggal (DECISIONS 415) — dipakai layarnya untuk menyebut
       * AKIBAT yang tidak ikut pindah sendiri, dan menautkan ke tanggal baru.
       * Halaman yang sedang dibuka bertanggal LAMA, jadi tanpa tautan itu orang
       * ditinggal menatap "Belum ada laporan" tanpa tahu isinya pindah ke mana.
       */
      pindah?: {
        slug: string;
        ke: string;
        lewatFinal: boolean;
        cuacaDibuang: boolean;
        waDilepas: boolean;
        fotoPerluCapUlang: number;
        fotoTakBisaDiperbaiki: number;
        snapshotDibangunUlang: number;
      };
    }
  | undefined;

/**
 * Ubah galat jadi PESAN, bukan jadi halaman mati.
 *
 * Laporan user 2026-08-07: *"masukkan foto ini dari galeri, pilih tidak di
 * lokasi proyek, langsung muncul halaman error minta reload"*.
 *
 * Apa pun galat yang menyebabkannya, MEKANISME yang mengubahnya jadi layar mati
 * ada di sini: dulu galat yang tidak masuk daftar putih dilempar ulang, dan
 * lemparan dari server action menjatuhkan seluruh halaman jadi "Application
 * error — reload". Yang hilang bukan cuma tampilan, melainkan satu-satunya
 * kesempatan memberi tahu APA yang salah — persis pelajaran mahal dari antrean
 * Foto Cepat (DECISIONS 284–287): layar yang diam saat gagal membuat perbaikan
 * jadi tebakan.
 *
 * Sekarang galat tak terduga tetap menghentikan aksinya, tapi:
 * - sebabnya DISEBUT di layar berikut nama galatnya, bisa difoto & dilaporkan;
 * - galat utuhnya tetap masuk log server — yang tidak boleh hilang adalah
 *   penyebabnya, bukan permintaannya.
 *
 * `redirect()`/`notFound()` Next bekerja DENGAN cara melempar; lemparan itu
 * harus tetap lewat, kalau tidak navigasinya rusak.
 */
function errState(err: unknown): DailyActionState {
  if (err instanceof DailyReportError || err instanceof PhotoError || err instanceof ForbiddenError) {
    return { error: err.message };
  }
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_")) throw err;

  console.error("[laporan-harian] galat tak terduga", err);
  const nama = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return { error: `Gagal diproses – ${nama}. Salin pesan ini saat melapor.` };
}

/** Ambil report + slug/dateKey untuk otorisasi & revalidate. */
async function loadReportContext(reportId: string) {
  const report = await db.dailyReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      locationId: true,
      reportDate: true,
      status: true,
      location: { select: { slug: true } },
    },
  });
  if (!report) throw new DailyReportError("Laporan tidak ditemukan");
  return { ...report, slug: report.location.slug, dateKey: jakartaDateKey(report.reportDate) };
}

function revalidateReport(slug: string, dateKey: string) {
  revalidatePath(`/lokasi/${slug}/harian/${dateKey}`);
  revalidatePath(`/lokasi/${slug}/harian`);
  revalidatePath("/hari-ini");
}

async function requireReviewOrCreate(): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, "daily_report.review") && !can(user.role, "daily_report.create")) {
    throw new ForbiddenError();
  }
  return user;
}

// ─────────────────────────────────────────────────────────────
// Item + foto (draft / perlu_koreksi)
// ─────────────────────────────────────────────────────────────

/** Field yang dikirim `PhotoSourceInput` — sama persis di kedua jalur unggah. */
const photoFieldsShape = {
  photoLat: z.coerce.number().min(-90).max(90).optional(),
  photoLng: z.coerce.number().min(-180).max(180).optional(),
  photoTakenAt: z.string().optional(),
  photoSource: z.enum(["camera", "gallery"]).optional(),
  galleryFallback: z.enum(["project", "none"]).optional(),
  /** "1" = pelapor menyatakan sedang berada DI LOKASI saat unggah galeri. */
  galleryAtSite: z.string().optional(),
};
type PhotoFields = z.infer<z.ZodObject<typeof photoFieldsShape>>;

/**
 * Medan foto satu baris → bentuk yang sudah tervalidasi.
 *
 * Nilai yang tidak masuk akal DIBUANG, bukan menggagalkan simpanan: koordinat
 * aneh dari peramban tidak boleh menahan angka material yang sudah benar. Yang
 * hilang cuma capnya, dan itu tetap terbaca di foto (gpsSource).
 */
function photoFieldsShapeParse(raw: Record<string, unknown>): PhotoFields {
  const r = z.object(photoFieldsShape).safeParse(raw);
  return r.success ? r.data : {};
}

function photoFieldsFrom(formData: FormData) {
  return {
    photoLat: formData.get("photoLat") || undefined,
    photoLng: formData.get("photoLng") || undefined,
    photoTakenAt: formData.get("photoTakenAt") || undefined,
    photoSource: formData.get("photoSource") || undefined,
    galleryFallback: formData.get("galleryFallback") || undefined,
    galleryAtSite: formData.get("galleryAtSite") || undefined,
  };
}

/**
 * Medan foto satu BARIS material/alat, dibaca lewat awalan (DECISIONS 343).
 *
 * Tiap baris punya pemilih fotonya sendiri di dalam form pelengkap yang sama,
 * jadi nama medannya diawali `m0_`, `m1_`, `a0_`, … Tanpa awalan, `photos`
 * seluruh baris menyatu jadi satu daftar dan tidak ada lagi cara mengetahui
 * foto mana milik baris mana — bukti akan menempel pada barang yang salah,
 * diam-diam.
 */
function fotoBarisDariForm(formData: FormData, awalan: string) {
  return {
    files: formData
      .getAll(`${awalan}photos`)
      .filter((f): f is File => f instanceof File && f.size > 0)
      .slice(0, MAX_PHOTOS_PER_UPLOAD),
    kantong: formData.getAll(`${awalan}kantongPhotoIds`).map(String).filter(Boolean),
    foto: {
      photoLat: formData.get(`${awalan}photoLat`) || undefined,
      photoLng: formData.get(`${awalan}photoLng`) || undefined,
      photoTakenAt: formData.get(`${awalan}photoTakenAt`) || undefined,
      photoSource: formData.get(`${awalan}photoSource`) || undefined,
      galleryFallback: formData.get(`${awalan}galleryFallback`) || undefined,
      galleryAtSite: formData.get(`${awalan}galleryAtSite`) || undefined,
    },
  };
}

/** Berkas foto dari FormData (maks 6/unggah, yang kosong dibuang). */
const fotoDariForm = (formData: FormData) =>
  formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, MAX_PHOTOS_PER_UPLOAD);

/** Lokasi + nama perusahaan untuk cap foto (pelaksana sesuai KONTRAK). */
async function muatLokasiCap(locationId: string) {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      slug: true,
      name: true,
      gpsLat: true,
      gpsLng: true,
      // Nama perusahaan utk cap foto = pelaksana sesuai KONTRAK (vendor);
      // fallback ke organisasi bila kontrak belum ada.
      package: {
        select: {
          organization: { select: { name: true } },
          contract: { select: { vendor: { select: { name: true, logoKey: true } } } },
        },
      },
    },
  });
  if (!location) throw new DailyReportError("Lokasi tidak ditemukan");
  return {
    location,
    companyName:
      location.package?.contract?.vendor?.name ?? location.package?.organization?.name ?? null,
    // Logo ikut nama: yang tercetak di cap harus milik perusahaan yang sama
    // dengan yang namanya tertulis (DECISIONS 424). Organisasi tidak punya
    // logo cap sendiri, jadi tanpa vendor → wordmark MARLIN.
    companyLogoKey: location.package?.contract?.vendor?.logoKey ?? null,
  };
}

/**
 * Unggah foto bukti untuk SATU item laporan.
 *
 * Dipakai DUA jalur — saat item disimpan, dan saat foto ditambahkan menyusul
 * (DECISIONS 226). Disatukan di sini karena aturan capnya identik, dan aturan
 * cap yang diduplikasi berarti foto susulan suatu hari bercap beda dari foto
 * yang menyertai itemnya.
 *
 * Gagal satu foto ≠ gagal seluruhnya: pesannya dikembalikan sebagai peringatan.
 */
/**
 * Unggah foto untuk baris MATERIAL / ALAT (DECISIONS 304).
 *
 * Memakai pipeline cap yang SAMA dengan foto pekerjaan — kompresi, arsip
 * berkas asli, dedup, dan cap yang dibakar ke gambar. Yang berbeda hanya
 * ISI capnya: badge = MATERIAL / PERALATAN, barisnya = nama barangnya.
 *
 * Aturan cap DECISIONS 197 tetap berlaku apa adanya: koordinat cadangan titik
 * proyek tetap ber-penanda, dan jam yang tidak diketahui tidak dikarang. Tidak
 * ada pengecualian untuk foto material — bukti tetap bukti.
 */
async function unggahFotoPelengkap(p: {
  user: SessionUser;
  location: Awaited<ReturnType<typeof muatLokasiCap>>["location"];
  companyName: string | null;
  companyLogoKey?: string | null;
  reportId: string;
  jenis: "material" | "alat";
  barisId: string;
  namaBaris: string;
  dateKey: string;
  files: File[];
  foto: PhotoFields;
}): Promise<string[]> {
  const { files, foto, location, user } = p;
  const photoErrors: string[] = [];
  let takenAt: Date | null = null;
  if (foto.photoTakenAt) {
    const t = new Date(foto.photoTakenAt);
    if (!Number.isNaN(t.getTime())) takenAt = t;
  }
  const source = foto.photoSource ?? "camera";
  const fallbackMode = foto.galleryFallback ?? "project";
  const wajibGps =
    files.length > 0 ? (await (await import("@/lib/policy")).getPolicy()).requirePhotoGps : false;
  if (wajibGps && source === "camera" && (foto.photoLat == null || foto.photoLng == null)) {
    throw new DailyReportError(
      "Foto kamera wajib membawa titik GPS, tapi perangkat tidak mengirimkannya. " +
        "Izinkan akses lokasi di browser, lalu foto ulang.",
    );
  }
  const locLat = location.gpsLat != null ? Number(location.gpsLat) : null;
  const locLng = location.gpsLng != null ? Number(location.gpsLng) : null;
  const workDate = new Date(`${p.dateKey}T00:00:00.000Z`);
  const badge = p.jenis === "material" ? "MATERIAL MASUK" : "PERALATAN";

  for (const file of files) {
    try {
      await savePhotoForItem({
        locationId: location.id,
        reportId: p.reportId,
        reportMaterialId: p.jenis === "material" ? p.barisId : null,
        reportEquipmentId: p.jenis === "alat" ? p.barisId : null,
        file,
        userId: user.id,
        locationSlug: location.slug,
        dateKey: p.dateKey,
        stamp: {
          source,
          fallbackMode,
          requireGps: wajibGps,
          atSite: foto.galleryAtSite === "1",
          lat: foto.photoLat ?? null,
          lng: foto.photoLng ?? null,
          locationLat: locLat,
          locationLng: locLng,
          takenAt,
          workDate,
          locationLabel: location.name,
          companyName: p.companyName,
          companyLogoKey: p.companyLogoKey ?? null,
          reporterName: user.fullName,
          categoryName: badge,
          workName: p.namaBaris,
        },
      });
    } catch (err) {
      if (err instanceof PhotoError) {
        photoErrors.push(err.message);
        continue;
      }
      // Sama seperti foto pekerjaan: satu berkas rusak tidak menjatuhkan
      // sisanya, dan penyebab aslinya tetap utuh di log server.
      console.error("[foto] gagal menyimpan satu berkas pelengkap", {
        reportId: p.reportId,
        jenis: p.jenis,
        barisId: p.barisId,
        nama: file.name,
        bytes: file.size,
        err,
      });
      photoErrors.push(`${file.name}: gagal diproses`);
    }
  }
  return photoErrors;
}

async function unggahFotoItem(p: {
  user: SessionUser;
  location: Awaited<ReturnType<typeof muatLokasiCap>>["location"];
  companyName: string | null;
  companyLogoKey?: string | null;
  reportId: string;
  itemId: string;
  rabNodeId: string;
  dateKey: string;
  files: File[];
  foto: PhotoFields;
}): Promise<string[]> {
  const { files, foto, location, user } = p;
  const photoErrors: string[] = [];
  let takenAt: Date | null = null;
  if (foto.photoTakenAt) {
    const t = new Date(foto.photoTakenAt);
    if (!Number.isNaN(t.getTime())) takenAt = t;
  }
  const source = foto.photoSource ?? "camera";
  const fallbackMode = foto.galleryFallback ?? "project";

  // Wajib-GPS (setelan, default mati — DECISIONS 219). Berlaku untuk KEDUA
  // jalur, tapi yang diwajibkan berbeda karena sumber koordinatnya berbeda:
  //   • Kamera → koordinat PERANGKAT saat memotret (dikirim dari browser).
  //   • Galeri → GPS di EXIF FOTO ITU SENDIRI; posisi perangkat saat unggah
  //     justru menyesatkan (unggah borongan lazim dilakukan dari kantor).
  // Pemeriksaan galeri per-berkas ada di `savePhotoForItem`, karena EXIF baru
  // terbaca di sana.
  const wajibGps = files.length > 0 ? (await (await import("@/lib/policy")).getPolicy()).requirePhotoGps : false;
  if (wajibGps && source === "camera" && (foto.photoLat == null || foto.photoLng == null)) {
    throw new DailyReportError(
      "Foto kamera wajib membawa titik GPS, tapi perangkat tidak mengirimkannya. " +
        "Izinkan akses lokasi di browser (tombol di atas tombol Kamera), lalu foto ulang.",
    );
  }
  const locLat = location.gpsLat != null ? Number(location.gpsLat) : null;
  const locLng = location.gpsLng != null ? Number(location.gpsLng) : null;
  const workDate = new Date(`${p.dateKey}T00:00:00.000Z`);
  // Cap foto: badge = BANGUNAN/kategori RAB, baris di bawahnya = item
  // pekerjaannya (permintaan user 2026-08-02, DECISIONS 218). Sebelumnya
  // badge hanya memuat nama item — dan di KNMP satu lokasi punya belasan
  // bangunan dengan nama item yang sama persis ("Pembesian", "Galian"),
  // sehingga fotonya tidak bisa dipertanggungjawabkan ke bangunan mana pun.
  const node = await db.rabNode.findUnique({
    where: { id: p.rabNodeId },
    select: { name: true, lineageKey: true, revisionId: true },
  });
  const workName = node?.name ?? null;
  let buildingName: string | null = null;
  if (node) {
    const kat = await db.rabNode.findFirst({
      where: {
        revisionId: node.revisionId,
        kind: "kategori",
        lineageKey: node.lineageKey.split("#")[0],
      },
      select: { code: true, name: true },
    });
    // Null bila kategorinya tidak ketemu — cap menulis apa adanya, tidak
    // mengarang bangunan (DECISIONS 197).
    if (kat) buildingName = kat.code ? `${kat.code}. ${kat.name}` : kat.name;
  }
  for (const file of files) {
    try {
      await savePhotoForItem({
        locationId: location.id,
        reportId: p.reportId,
        reportItemId: p.itemId,
        file,
        userId: user.id,
        locationSlug: location.slug,
        dateKey: p.dateKey,
        stamp: {
          source,
          fallbackMode,
          requireGps: wajibGps,
          atSite: foto.galleryAtSite === "1",
          lat: foto.photoLat ?? null,
          lng: foto.photoLng ?? null,
          locationLat: locLat,
          locationLng: locLng,
          takenAt,
          workDate,
          locationLabel: location.name,
          companyName: p.companyName,
          companyLogoKey: p.companyLogoKey ?? null,
          reporterName: user.fullName,
          categoryName: buildingName ?? workName,
          workName: buildingName ? workName : null,
        },
      });
    } catch (err) {
      if (err instanceof PhotoError) {
        photoErrors.push(err.message);
        continue;
      }
      // SATU foto rusak tidak boleh menjatuhkan seluruh penyimpanan.
      //
      // Dulu error non-PhotoError dilempar ulang, dan itu melewati semua
      // penanganan: volume sudah tersimpan, foto lain batal, dan pelapor cuma
      // melihat halaman error tanpa tahu apa yang jadi dan apa yang tidak.
      // Terjadi di produksi 2026-08-03 — EXIF cacat membuat Prisma menolak
      // koordinat "NaN" (DECISIONS 231).
      //
      // Sebabnya tetap DICATAT UTUH ke log server: yang tidak boleh hilang
      // adalah penyebabnya, bukan permintaannya.
      console.error("[foto] gagal menyimpan satu berkas", {
        reportId: p.reportId,
        itemId: p.itemId,
        nama: file.name,
        bytes: file.size,
        err,
      });
      photoErrors.push(`${file.name}: gagal diproses`);
    }
  }
  return photoErrors;
}

const saveItemSchema = z.object({
  locationId: z.uuid(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid"),
  rabNodeId: z.uuid("Pilih item pekerjaan dulu"),
  volumeDone: z.coerce.number().positive("Volume harus lebih dari 0"),
  notes: z.string().trim().max(500).optional(),
  /**
   * Foto kantong Foto Cepat yang dipilih DI FORMULIR, sebelum item ini ada.
   *
   * Permintaan user 2026-08-07: *"seharusnya di tampilan utama pilih pekerjaan,
   * selain kamera, galeri, kantong harusnya langsung bisa dipilih sebelum
   * simpan item... ini default paling nyaman"*. Memang tidak mungkin
   * MENAUTKANNYA lebih dulu — penautan butuh item yang sudah punya id. Yang
   * mungkin: memilihnya lebih dulu, lalu menautkan tepat sesudah itemnya
   * tersimpan. Dari sisi pelapor hasilnya sama, dan itu yang penting.
   */
  kantongPhotoIds: z.array(z.uuid()).max(20).optional(),
  ...photoFieldsShape,
});

export async function saveItemAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const parsed = saveItemSchema.safeParse({
      locationId: formData.get("locationId"),
      dateKey: formData.get("dateKey"),
      rabNodeId: formData.get("rabNodeId"),
      volumeDone: formData.get("volumeDone"),
      notes: formData.get("notes") ?? undefined,
      kantongPhotoIds: formData.getAll("kantongPhotoIds").map(String),
      ...photoFieldsFrom(formData),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    await requireLocationAccess(user, d.locationId);

    const { location, companyName } = await muatLokasiCap(d.locationId);

    const report = await getOrCreateDraft(d.locationId, d.dateKey, user.id);
    const item = await upsertItem(
      report.id,
      { rabNodeId: d.rabNodeId, volumeDone: d.volumeDone, notes: d.notes ?? null },
      user.id,
    );

    // Foto bukti (opsional, maks 6/unggah). Gagal satu foto ≠ gagal item.
    const photoErrors = await unggahFotoItem({
      user,
      location,
      companyName,
      reportId: report.id,
      itemId: item.id,
      rabNodeId: d.rabNodeId,
      dateKey: d.dateKey,
      files: fotoDariForm(formData),
      foto: d,
    });

    /*
     * Foto kantong yang dipilih di formulir ditautkan SESUDAH itemnya ada.
     *
     * Kegagalan di sini TIDAK membatalkan progresnya: volume sudah tersimpan
     * dan itu angka yang masuk ke kurva-S. Membatalkannya karena satu foto
     * bermasalah akan menghapus pekerjaan yang benar demi lampiran yang
     * opsional. Yang gagal DISEBUTKAN, dan fotonya tetap utuh di kantong
     * sehingga bisa dicoba lagi dari daftar pekerjaan.
     */
    let kantongGagal: string | undefined;
    if (d.kantongPhotoIds && d.kantongPhotoIds.length > 0) {
      const { pakaiFotoKeTujuan } = await import("@/lib/foto-cepat/pakai");
      const hasil = await pakaiFotoKeTujuan(user, d.kantongPhotoIds, {
        tujuan: "laporan",
        reportItemId: item.id,
      });
      if ("error" in hasil) kantongGagal = `Foto kantong tidak terpakai: ${hasil.error}`;
      else if (hasil.gagalCap.length > 0)
        kantongGagal =
          `${hasil.gagalCap.length} foto kantong memakai cap dasar ` +
          `(${[...new Set(hasil.gagalCap)].join(", ")}) – foto & datanya tetap utuh.`;
    }

    revalidateReport(location.slug, d.dateKey);
    const peringatan = [
      photoErrors.length ? `Sebagian foto gagal: ${[...new Set(photoErrors)].join("; ")}` : null,
      kantongGagal ?? null,
    ].filter(Boolean);
    return {
      success: "Progres tersimpan.",
      warning: peringatan.length ? peringatan.join(" · ") : undefined,
    };
  } catch (err) {
    return errState(err);
  }
}

/**
 * Tambah foto MENYUSUL ke item yang sudah tersimpan (DECISIONS 226).
 *
 * Permintaan user 2026-08-02: *"jika pekerjaan berhasil disimpan, tapi foto
 * belum ada, saat ini belum ada kejelasan bagaimana edit/menambahkan foto yang
 * ketinggalan"*. Memang belum ada. Foto itu opsional saat menyimpan, jadi
 * ketinggalan foto adalah keadaan yang WAJAR — bukan kasus tepi.
 *
 * Jalan memutar yang tersedia sebelumnya (pilih ulang pekerjaan yang sama di
 * form atas lalu simpan ulang) memaksa pelapor MENGETIK ULANG volume yang sudah
 * benar. Satu salah ketik di situ mengubah angka progres — menambah foto tidak
 * boleh punya risiko itu. Aksi ini TIDAK menyentuh volume maupun catatan.
 */
const addPhotosSchema = z.object({
  reportId: z.uuid(),
  itemId: z.uuid(),
  ...photoFieldsShape,
});

export async function addItemPhotosAction(
  _prev: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const parsed = addPhotosSchema.safeParse({
      reportId: formData.get("reportId"),
      itemId: formData.get("itemId"),
      ...photoFieldsFrom(formData),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const ctx = await loadReportContext(d.reportId);
    await requireLocationAccess(user, ctx.locationId);
    // Batas yang sama dengan hapus foto: begitu laporan dikirim, fotonya sudah
    // jadi dasar verifikasi — menambah bukti setelah itu bukan koreksi.
    if (!EDITABLE_STATUSES.includes(ctx.status)) {
      return { error: "Laporan sudah dikirim – foto tidak bisa ditambah lagi." };
    }

    const item = await db.dailyReportItem.findFirst({
      where: { id: d.itemId, reportId: ctx.id },
      select: { id: true, rabNodeId: true },
    });
    if (!item) return { error: "Item tidak ditemukan di laporan ini." };

    const files = fotoDariForm(formData);
    if (files.length === 0) return { error: "Belum ada foto yang dipilih." };

    const { location, companyName } = await muatLokasiCap(ctx.locationId);
    const photoErrors = await unggahFotoItem({
      user,
      location,
      companyName,
      reportId: ctx.id,
      itemId: item.id,
      rabNodeId: item.rabNodeId,
      dateKey: ctx.dateKey,
      files,
      foto: d,
    });

    const berhasil = files.length - photoErrors.length;
    revalidateReport(ctx.slug, ctx.dateKey);
    // Nol berhasil bukan "sukses sebagian" — itu gagal, dan harus terbaca gagal.
    if (berhasil === 0) {
      return { error: `Foto tidak tersimpan: ${[...new Set(photoErrors)].join("; ")}` };
    }
    return {
      success: `${berhasil} foto ditambahkan.`,
      warning: photoErrors.length
        ? `Sebagian foto gagal: ${[...new Set(photoErrors)].join("; ")}`
        : undefined,
    };
  } catch (err) {
    return errState(err);
  }
}

const removeItemSchema = z.object({ reportId: z.uuid(), itemId: z.uuid() });

export async function removeItemAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const parsed = removeItemSchema.safeParse({
      reportId: formData.get("reportId"),
      itemId: formData.get("itemId"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const ctx = await loadReportContext(parsed.data.reportId);
    await requireLocationAccess(user, ctx.locationId);
    await removeItem(ctx.id, parsed.data.itemId, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Item dihapus." };
  } catch (err) {
    return errState(err);
  }
}

/**
 * Hapus SATU foto bukti dari laporan harian (baris DB + objek R2).
 *
 * Sebelum ini foto sama sekali tidak bisa dihapus: aksinya memang tidak pernah
 * ada. Lebih buruk, menghapus item pekerjaan hanya MELEPAS fotonya
 * (`reportItemId = null`) — foto itu lalu tidak tampil di mana pun dan jadi
 * mustahil dibersihkan, baik dari layar maupun dari bucket.
 *
 * Aturan (keputusan user 28 Juli 2026):
 * - Hanya saat laporan masih DRAFT atau PERLU KOREKSI. Begitu dikirim, foto
 *   sudah jadi dasar verifikasi — mengubah bukti setelah itu bukan koreksi.
 * - Yang boleh: PENGUNGGAH foto itu sendiri, Site Manager, atau Super Admin.
 */
const photoIdSchema = z.object({ photoId: z.uuid("Foto tidak valid.") });

/** Peran yang boleh menghapus foto milik orang lain. */
const PERAN_BOLEH_HAPUS_FOTO_ORANG_LAIN: UserRole[] = ["site_manager", "super_admin"];

export async function removeReportPhotoAction(
  _prev: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const parsed = photoIdSchema.safeParse({ photoId: formData.get("photoId") });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const photo = await db.photo.findUnique({
      where: { id: parsed.data.photoId },
      select: {
        id: true,
        r2Key: true,
        thumbnailKey: true,
        uploadedById: true,
        reportId: true,
        report: {
          select: {
            id: true,
            status: true,
            locationId: true,
            reportDate: true,
            location: { select: { slug: true } },
          },
        },
      },
    });
    if (!photo?.report) return { error: "Foto laporan tidak ditemukan." };
    await requireLocationAccess(user, photo.report.locationId);

    if (!EDITABLE_STATUSES.includes(photo.report.status)) {
      return { error: "Foto hanya bisa dihapus saat laporan berstatus Draft atau Perlu Koreksi." };
    }
    const miliknyaSendiri = photo.uploadedById !== null && photo.uploadedById === user.id;
    if (!miliknyaSendiri && !PERAN_BOLEH_HAPUS_FOTO_ORANG_LAIN.includes(user.role)) {
      return { error: "Hanya pengunggah foto, Site Manager, atau Super Admin yang bisa menghapus foto ini." };
    }

    // Baris dulu, objek belakangan: gagal hapus objek hanya menyisakan berkas
    // tak terpakai, sedangkan urutan sebaliknya menyisakan foto rusak di layar.
    await db.photo.delete({ where: { id: photo.id } });
    if (isR2Configured()) {
      await Promise.all(
        [photo.r2Key, photo.thumbnailKey]
          .filter((k): k is string => !!k)
          .map((k) => r2Delete(k).catch(() => {})),
      );
    }
    await audit(user.id, "daily_report.photo_remove", "photo", photo.id, {
      reportId: photo.report.id,
      uploadedById: photo.uploadedById,
    });

    revalidateReport(photo.report.location.slug, jakartaDateKey(photo.report.reportDate));
    return { success: "Foto dihapus." };
  } catch (err) {
    return errState(err);
  }
}

/**
 * Kembalikan foto YATIM ke kantong Foto Cepat supaya bisa dipakai lagi.
 *
 * Pertanyaan user 2026-08-07: *"item pekerjaan dihapus, foto jadi orphan...
 * kalau mau dipakai lagi bagaimana"*.
 *
 * Sebelum ini jawabannya: tidak bisa. Satu-satunya aksi yang ditawarkan pada
 * foto yatim adalah HAPUS — padahal foto itu bukti lapangan yang koordinat dan
 * waktunya benar; yang salah cuma pekerjaan yang ditempelinya. Menyuruh orang
 * membuangnya lalu memotret ulang adalah menyuruh membuat bukti yang lebih
 * buruk (dipotret belakangan, dari tempat lain).
 *
 * Yang dilakukan: melepas fotonya dari laporan (`reportId = null`) sehingga ia
 * kembali muncul di kantong lokasi itu dan bisa dipilih untuk pekerjaan mana pun
 * lewat jalur "Foto Cepat" yang sudah ada — bukan jalur penautan baru.
 *
 * Batas yang dijaga:
 * - Hanya foto YATIM. Foto yang masih menempel pada satu pekerjaan tidak boleh
 *   dilepas lewat sini: itu akan mencabut bukti dari item tanpa mengatakannya.
 * - Jendela sunting & peran sama persis dengan hapus foto.
 * - Kalau lokasinya belum tercatat, diisi dari LOKASI LAPORAN tempat foto itu
 *   menempel — bukan tebakan: fotonya memang terlampir di laporan lokasi itu.
 *   Tetap disebutkan di pesan hasilnya, tidak diam-diam.
 */
export async function returnPhotoToKantongAction(
  _prev: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const parsed = photoIdSchema.safeParse({ photoId: formData.get("photoId") });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const photo = await db.photo.findUnique({
      where: { id: parsed.data.photoId },
      select: {
        id: true,
        uploadedById: true,
        locationId: true,
        reportItemId: true,
        report: {
          select: {
            id: true,
            status: true,
            locationId: true,
            reportDate: true,
            location: { select: { slug: true } },
          },
        },
      },
    });
    if (!photo?.report) return { error: "Foto laporan tidak ditemukan." };
    await requireLocationAccess(user, photo.report.locationId);

    if (photo.reportItemId) {
      return {
        error:
          "Foto ini masih menempel pada satu pekerjaan. Hapus dulu fotonya dari pekerjaan itu kalau memang mau dipindah.",
      };
    }
    if (!EDITABLE_STATUSES.includes(photo.report.status)) {
      return { error: "Hanya bisa saat laporan berstatus Draft atau Perlu Koreksi." };
    }
    const miliknyaSendiri = photo.uploadedById !== null && photo.uploadedById === user.id;
    if (!miliknyaSendiri && !PERAN_BOLEH_HAPUS_FOTO_ORANG_LAIN.includes(user.role)) {
      return {
        error: "Hanya pengunggah foto, Site Manager, atau Super Admin yang bisa memindahkan foto ini.",
      };
    }

    const lokasiDiisi = photo.locationId == null;
    await db.$transaction(async (tx) => {
      await tx.photo.update({
        where: { id: photo.id },
        data: {
          reportId: null,
          reportItemId: null,
          locationId: photo.locationId ?? photo.report!.locationId,
        },
      });
      await auditIn(tx, user.id, "daily_report.photo_to_kantong", "photo", photo.id, {
        reportId: photo.report!.id,
        locationId: photo.locationId ?? photo.report!.locationId,
        lokasiDiisiDariLaporan: lokasiDiisi,
      });
    });

    revalidateReport(photo.report.location.slug, jakartaDateKey(photo.report.reportDate));
    revalidatePath("/foto-cepat");
    return {
      success: lokasiDiisi
        ? "Foto kembali ke kantong Foto Cepat; lokasinya diisi dari lokasi laporan ini. Pilih lewat tombol “Foto Cepat” di pekerjaan yang dituju."
        : "Foto kembali ke kantong Foto Cepat. Pilih lewat tombol “Foto Cepat” di pekerjaan yang dituju.",
    };
  } catch (err) {
    return errState(err);
  }
}

// ─────────────────────────────────────────────────────────────
// Pelengkap KKP (draft / perlu_koreksi / dikirim)
// ─────────────────────────────────────────────────────────────

const enrichmentSchema = z.object({
  reportId: z.uuid(),
  // optional = field tidak dikirim (pemilih manual dimatikan) → jangan sentuh
  // kolom cuaca; nullable = dikosongkan sengaja. Lihat EnrichmentInput.
  weather: z.enum(WEATHER_ORDER as [WeatherCode, ...WeatherCode[]]).nullable().optional(),
  workStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  workEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

/**
 * Ambil kondisi cuaca PER JAM dari layanan cuaca berdasarkan koordinat lokasi.
 * Selalu dipicu tombol (bukan diam-diam saat halaman dibuka) supaya orang
 * lapangan tahu angkanya datang dari mana, dan supaya laporan tidak pernah
 * tertahan menunggu jaringan. Isian manual menang — lihat weather/service.ts.
 */
export async function fetchWeatherAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireReviewOrCreate();
    const reportId = z.uuid().safeParse(formData.get("reportId"));
    if (!reportId.success) return { error: "Laporan tidak valid." };
    const ctx = await loadReportContext(reportId.data);
    await requireLocationAccess(user, ctx.locationId);
    if (
      !can(user.role, "daily_report.review") &&
      !(CREATOR_ENRICHABLE_STATUSES as readonly string[]).includes(ctx.status)
    ) {
      return { error: "Laporan sudah dikirim – data KKP dilengkapi oleh Site Manager saat verifikasi." };
    }

    let result;
    try {
      result = await applyWeatherToReport(ctx.id, {
        overwriteManual: formData.get("overwriteManual") === "1",
      });
    } catch (e) {
      if (e instanceof WeatherError || e instanceof WeatherFetchError) return { error: e.message };
      throw e;
    }

    await audit(user.id, "daily_report.weather_fetch", "daily_report", ctx.id, {
      hours: result.hours.length,
      weather: result.weather,
      cached: result.cached,
    });
    revalidateReport(ctx.slug, ctx.dateKey);
    const hujan = result.hours.filter((h) => h.category === "Hujan").length;
    return {
      success:
        `Cuaca ${result.hours.length} jam terisi otomatis` +
        (hujan > 0 ? ` – ${hujan} jam hujan.` : " – tidak ada jam hujan.") +
        " Ubah manual bila berbeda dengan kondisi di lapangan.",
    };
  } catch (err) {
    return errState(err);
  }
}

export async function saveEnrichmentAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireReviewOrCreate();
    const parsed = enrichmentSchema.safeParse({
      reportId: formData.get("reportId"),
      weather: formData.has("weather") ? formData.get("weather") || null : undefined,
      workStart: formData.get("workStart") || null,
      workEnd: formData.get("workEnd") || null,
      notes: (formData.get("notes") as string | null) || null,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const ctx = await loadReportContext(parsed.data.reportId);
    await requireLocationAccess(user, ctx.locationId);
    // Pembuat (tanpa capability review) hanya boleh melengkapi draft /
    // perlu_koreksi; laporan "dikirim" dilengkapi reviewer (B16b).
    if (
      !can(user.role, "daily_report.review") &&
      !(CREATOR_ENRICHABLE_STATUSES as readonly string[]).includes(ctx.status)
    ) {
      return { error: "Laporan sudah dikirim – data KKP dilengkapi oleh Site Manager saat verifikasi." };
    }

    const workers = WORKER_ROLE_ORDER.map((role: WorkerRole) => ({
      role,
      count: Math.max(0, Math.trunc(Number(formData.get(`worker_${role}`) ?? 0)) || 0),
    }));
    /*
     * `materialId` / `equipmentId` ikut dikirim per baris supaya identitas
     * barisnya BERTAHAN (DECISIONS 304) — foto menempel padanya. Kosong =
     * baris baru. Larik-larik ini sejajar per indeks, jadi form WAJIB
     * memancarkan keempat field untuk setiap baris, termasuk yang kosong.
     */
    const materialIds = formData.getAll("materialId").map(String);
    const materialNames = formData.getAll("materialName").map(String);
    const materialUnits = formData.getAll("materialUnit").map(String);
    const materialQtys = formData.getAll("materialQty").map(String);
    const materials = materialNames.map((name, i) => ({
      id: materialIds[i] || null,
      name,
      unit: materialUnits[i] || null,
      qty: materialQtys[i] ? Number(materialQtys[i]) : null,
    }));
    const equipmentIds = formData.getAll("equipmentId").map(String);
    const equipmentNames = formData.getAll("equipmentName").map(String);
    const equipmentCounts = formData.getAll("equipmentCount").map(String);
    const equipment = equipmentNames.map((name, i) => ({
      id: equipmentIds[i] || null,
      name,
      count: Math.max(1, Math.trunc(Number(equipmentCounts[i] ?? 1)) || 1),
    }));

    const { idMaterial, idAlat } = await setEnrichment(
      ctx.id,
      {
        weather: parsed.data.weather,
        workStart: parsed.data.workStart,
        workEnd: parsed.data.workEnd,
        notes: parsed.data.notes,
        workers,
        materials,
        equipment,
      },
      user.id,
    );

    /*
     * FOTO IKUT SIMPANAN — tidak ada lagi "simpan dulu, baru foto"
     * (DECISIONS 343, mengoreksi 341/342).
     *
     * Pola yang sama sudah dipakai form item pekerjaan sejak lama: fotonya
     * dikirim bersama simpanan, dan penautannya diurus sesudah barisnya punya
     * id. Menagih penggunanya menyimpan lebih dulu adalah memindahkan
     * pembukuan kami ke pundaknya.
     *
     * Kegagalan foto TIDAK membatalkan simpanan: angka & nama sudah tersimpan,
     * dan mengembalikannya hanya karena satu berkas gagal diunggah akan
     * menghapus pekerjaan yang sudah benar. Kegagalannya DISEBUTKAN.
     */
    const galatFoto: string[] = [];
    let fotoBaru = 0;
    // Impor dinamis, pola yang sama dengan jalur item pekerjaan di atas:
    // modul foto-cepat menarik rantai R2 + cap yang tidak dibutuhkan simpanan
    // pelengkap yang tanpa foto.
    const { pakaiFotoKeTujuan } = await import("@/lib/foto-cepat/pakai");
    const adaFoto = [...formData.keys()].some((k) => /^[ma]\d+_(photos|kantongPhotoIds)$/.test(k));
    if (adaFoto) {
      const { location, companyName } = await muatLokasiCap(ctx.locationId);
      const jalur: { jenis: "material" | "alat"; awalan: string; ids: (string | null)[] }[] = [
        { jenis: "material", awalan: "m", ids: idMaterial },
        { jenis: "alat", awalan: "a", ids: idAlat },
      ];
      for (const j of jalur) {
        for (const [i, barisId] of j.ids.entries()) {
          const b = fotoBarisDariForm(formData, `${j.awalan}${i}_`);
          if (b.files.length === 0 && b.kantong.length === 0) continue;
          if (!barisId) {
            // Baris tanpa nama dibuang penyimpanan — fotonya tidak punya induk.
            galatFoto.push("ada foto pada baris yang namanya belum diisi");
            continue;
          }
          const nama =
            j.jenis === "material" ? (materials[i]?.name ?? "") : (equipment[i]?.name ?? "");
          if (b.files.length > 0) {
            const gagal = await unggahFotoPelengkap({
              user,
              location,
              companyName,
              reportId: ctx.id,
              jenis: j.jenis,
              barisId,
              namaBaris: nama,
              dateKey: ctx.dateKey,
              files: b.files,
              foto: photoFieldsShapeParse(b.foto),
            });
            fotoBaru += b.files.length - gagal.length;
            galatFoto.push(...gagal);
          }
          if (b.kantong.length > 0) {
            const hasil = await pakaiFotoKeTujuan(user, b.kantong, {
              tujuan: j.jenis === "material" ? "material" : "alat",
              barisId,
            });
            if ("error" in hasil) galatFoto.push(hasil.error);
            else {
              fotoBaru += hasil.dipakai;
              galatFoto.push(...hasil.gagalCap);
            }
          }
        }
      }
    }

    revalidateReport(ctx.slug, ctx.dateKey);
    const kabar = fotoBaru > 0
      ? `Pelengkap laporan tersimpan – ${fotoBaru} foto ditambahkan.`
      : "Pelengkap laporan tersimpan.";
    return {
      success: kabar,
      warning: galatFoto.length
        ? `Sebagian foto gagal: ${[...new Set(galatFoto)].join("; ")}`
        : undefined,
    };
  } catch (err) {
    return errState(err);
  }
}

// ─────────────────────────────────────────────────────────────
// Transisi status
// ─────────────────────────────────────────────────────────────

/**
 * Kirim laporan — SEKALIAN mencatat kendala yang dijawab di lembar kirim
 * (DECISIONS 341).
 *
 * Satu aksi, bukan dua berurutan. Dua aksi berarti dua ketukan dan satu
 * keadaan antara yang berbahaya: kendala tercatat tapi laporannya gagal
 * terkirim, atau sebaliknya. Di sini kendalanya dicatat LEBIH DULU — kalau
 * pencatatannya gagal, laporan tidak jadi terkirim dan orangnya masih memegang
 * kalimat yang barusan ia tulis.
 */
export async function submitReportAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const reportId = z.uuid().parse(formData.get("reportId"));
    const ctx = await loadReportContext(reportId);
    await requireLocationAccess(user, ctx.locationId);

    const kendala = bacaKendalaKirim({
      pilihan: formData.get("kendalaPilihan"),
      title: formData.get("kendalaTitle"),
      severity: formData.get("kendalaSeverity"),
      description: formData.get("kendalaDescription"),
    });
    if (!kendala.ok) return { error: kendala.error };
    /*
     * Kendala yang mirip dengan yang MASIH TERBUKA tidak dicatat dua kali
     * (DECISIONS 407) – dan itu TIDAK menggagalkan pengiriman laporan. Menahan
     * laporan harian karena urusan papan kendala berarti menukar kerugian kecil
     * (satu baris kembar) dengan kerugian besar (laporan hari itu tidak terkirim
     * sama sekali).
     */
    const hasil = kendala.kendala
      ? await addIssueFromReport(
          ctx.id,
          {
            title: kendala.kendala.title,
            description: kendala.kendala.description,
            severity: kendala.kendala.severity,
          },
          user.id,
        )
      : null;

    await submitReport(reportId, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return {
      success:
        hasil?.jadi === "dibuat"
          ? "Laporan terkirim beserta 1 kendala – menunggu verifikasi."
          : hasil?.jadi === "duplikat"
            ? `Laporan terkirim – menunggu verifikasi. Kendala serupa sudah terbuka ("${hasil.title}"), jadi tidak dicatat dua kali.`
            : "Laporan terkirim – menunggu verifikasi.",
    };
  } catch (err) {
    return errState(err);
  }
}

export async function returnReportAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.review");
    const reportId = z.uuid().parse(formData.get("reportId"));
    const reason = z
      .string()
      .trim()
      .min(3, "Alasan pengembalian wajib diisi (min 3 karakter)")
      .max(1000)
      .safeParse(formData.get("reason"));
    if (!reason.success) return { error: reason.error.issues[0].message };
    const ctx = await loadReportContext(reportId);
    await requireLocationAccess(user, ctx.locationId);
    await returnReport(reportId, reason.data, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Laporan dikembalikan untuk koreksi." };
  } catch (err) {
    return errState(err);
  }
}

export async function approveReportAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.review");
    const reportId = z.uuid().parse(formData.get("reportId"));
    const ctx = await loadReportContext(reportId);
    await requireLocationAccess(user, ctx.locationId);
    await approveReport(reportId, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Laporan disetujui." };
  } catch (err) {
    return errState(err);
  }
}

/**
 * Dorong antrean unggah Drive SESUDAH respons finalisasi terkirim.
 *
 * `after()` dipakai supaya orang yang menekan "Finalisasi" tidak menunggui
 * unggahan PDF + belasan foto ke Google. Yang didorong hanya SEDIKIT pekerjaan
 * dan TANPA pindai: tujuannya membuat laporan yang baru saja difinalisasi
 * terasa langsung sampai, bukan menyapu seluruh backlog di punggung satu
 * penekanan tombol — itu tugas penjadwal (DECISIONS 313).
 *
 * Gagal menjadwalkan bukan masalah: barisnya sudah tercatat di antrean, dan
 * putaran cron berikutnya akan mengambilnya.
 */
function dorongAntreanDrive(): void {
  try {
    after(async () => {
      const { jalankanAntreanDrive } = await import("@/lib/gdrive/antrean");
      await jalankanAntreanDrive({ pindai: false, maksPekerjaan: 3 });
    });
  } catch (err) {
    console.error("[daily-report] gagal menjadwalkan unggah Drive:", err);
  }
}

export async function finalizeReportAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.finalize");
    const reportId = z.uuid().parse(formData.get("reportId"));
    const ctx = await loadReportContext(reportId);
    await requireLocationAccess(user, ctx.locationId);
    await finalizeReport(reportId, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    dorongAntreanDrive();
    return { success: "Laporan difinalisasi – siap dicetak." };
  } catch (err) {
    return errState(err);
  }
}

/**
 * Buka kunci laporan final untuk koreksi (super_admin saja). Wajib alasan —
 * tercatat di histori status supaya jelas kenapa laporan resmi dibuka lagi.
 * DECISIONS 149.
 */
export async function unfinalizeReportAction(
  _prev: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.unfinalize");
    const parsed = z
      .object({
        reportId: z.uuid(),
        reason: z.string().trim().min(10, "Alasan koreksi wajib diisi (minimal 10 karakter)"),
      })
      .safeParse({ reportId: formData.get("reportId"), reason: formData.get("reason") });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await loadReportContext(parsed.data.reportId);
    await requireLocationAccess(user, ctx.locationId);
    await unfinalizeReport(parsed.data.reportId, user.id, parsed.data.reason);
    revalidateReport(ctx.slug, ctx.dateKey);
    return {
      success:
        "Laporan dibuka kembali (status: Disetujui) dan bisa dikoreksi. " +
        "Finalkan ulang setelah selesai supaya cetakannya diperbarui.",
    };
  } catch (err) {
    return errState(err);
  }
}

/**
 * PINDAHKAN LAPORAN KE TANGGAL LAIN (DECISIONS 415).
 *
 * User 2026-08-22, atas laporan yang dikembalikan karena salah tanggal: *"ini
 * terlalu ribet untuk edit, padahal bisa sekali klik, ganti tanggal saja."*
 *
 * Super admin SAJA (pilihan user) — menggeser tanggal berarti menggeser volume
 * ke hari lain, dan itu menggerakkan kurva-S serta deviasi.
 */
export async function pindahTanggalAction(
  _prev: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.move_date");
    const parsed = z
      .object({
        reportId: z.uuid(),
        tanggalBaru: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tujuan wajib diisi"),
        alasan: z.string().trim().min(10, "Alasan pemindahan wajib diisi (minimal 10 karakter)"),
      })
      .safeParse({
        reportId: formData.get("reportId"),
        tanggalBaru: formData.get("tanggalBaru"),
        alasan: formData.get("alasan"),
      });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const ctx = await loadReportContext(parsed.data.reportId);
    await requireLocationAccess(user, ctx.locationId);

    const { pindahTanggalLaporan } = await import("./pindah-tanggal-service");
    const hasil = await pindahTanggalLaporan({
      reportId: parsed.data.reportId,
      tanggalBaru: parsed.data.tanggalBaru,
      alasan: parsed.data.alasan,
      userId: user.id,
    });

    // DUA tanggal disegarkan: yang ditinggalkan sekarang kosong, dan yang
    // dituju sekarang berisi. Menyegarkan salah satunya saja meninggalkan
    // kalender yang menampilkan laporan di dua tempat sekaligus.
    revalidateReport(ctx.slug, hasil.dari);
    revalidateReport(ctx.slug, hasil.ke);
    return {
      success: `Laporan dipindah ke ${hasil.ke}.`,
      pindah: {
        slug: ctx.slug,
        ke: hasil.ke,
        lewatFinal: hasil.lewatFinal,
        cuacaDibuang: hasil.cuacaDibuang,
        waDilepas: hasil.waDilepas,
        fotoPerluCapUlang: hasil.foto.perluCapUlang,
        fotoTakBisaDiperbaiki: hasil.foto.takBisaDiperbaiki,
        snapshotDibangunUlang: hasil.snapshotDibangunUlang,
      },
    };
  } catch (err) {
    return errState(err);
  }
}

// ─────────────────────────────────────────────────────────────
// Kendala (Issue) dari laporan
// ─────────────────────────────────────────────────────────────

const issueSchema = z.object({
  reportId: z.uuid(),
  title: z.string().trim().min(3, "Judul kendala wajib diisi (min 3 karakter)").max(200),
  description: z.string().trim().max(2000).optional(),
  severity: z.enum(["rendah", "sedang", "tinggi", "kritis"]),
  /** Dikirim hanya oleh tombol "Tetap buat baru" sesudah tawaran duplikat. */
  paksa: z.boolean().optional(),
});

export async function addIssueAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireUser();
    if (!can(user.role, "issue.manage") && !can(user.role, "daily_report.create")) {
      throw new ForbiddenError();
    }
    const parsed = issueSchema.safeParse({
      reportId: formData.get("reportId"),
      title: formData.get("title"),
      description: formData.get("description") ?? undefined,
      severity: formData.get("severity"),
      paksa: String(formData.get("paksa") ?? "") === "1" || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const ctx = await loadReportContext(parsed.data.reportId);
    await requireLocationAccess(user, ctx.locationId);
    const hasil = await addIssueFromReport(
      ctx.id,
      {
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        severity: parsed.data.severity,
      },
      user.id,
      { paksa: parsed.data.paksa },
    );
    revalidateReport(ctx.slug, ctx.dateKey);
    if (hasil.jadi === "duplikat") {
      /*
       * Bukan galat – tawaran (DECISIONS 407). Yang sudah diketik dikembalikan
       * bersama tawarannya supaya "Tetap buat baru" tidak berarti mengetik ulang.
       */
      return {
        kendalaDuplikat: { id: hasil.issueId, title: hasil.title },
        kendalaNilai: {
          title: parsed.data.title,
          description: parsed.data.description ?? "",
          severity: parsed.data.severity,
        },
      };
    }
    return { success: "Kendala tercatat." };
  } catch (err) {
    return errState(err);
  }
}

const hariNihilSchema = z.object({
  /*
   * Lokasi + tanggal, BUKAN reportId.
   *
   * Hari yang benar-benar tanpa kegiatan belum punya draft sama sekali — draft
   * baru lahir saat item pertama disimpan. Menuntut `reportId` membuat fitur
   * ini mustahil dipakai justru di hari yang membutuhkannya. DECISIONS 396.
   */
  locationId: z.uuid(),
  dateKey: z.iso.date("Tanggal tidak valid"),
  nihil: z.boolean(),
  alasan: z.enum(ALASAN_NIHIL).optional(),
  catatan: z.string().trim().max(500).optional(),
});

/**
 * Nyatakan / batalkan "hari ini tidak ada kegiatan" (DECISIONS 396).
 *
 * Bila sebabnya "menunggu", pengembaliannya membawa `usulKendala` — layar
 * MENAWARKAN mencatatnya sebagai kendala supaya ditagih, tidak memaksanya.
 * Memaksa akan memenuhi papan dengan baris dari hari yang sebenarnya satu
 * masalah berlarut; tidak menawarkan sama sekali mengulang cacat yang baru saja
 * diperbaiki — hambatan tercatat lalu tidak ditagih siapa pun.
 */
export async function setHariNihilAction(
  _prev: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const parsed = hariNihilSchema.safeParse({
      locationId: formData.get("locationId"),
      dateKey: formData.get("dateKey"),
      nihil: String(formData.get("nihil") ?? "") === "1",
      alasan: String(formData.get("alasan") ?? "").trim() || undefined,
      catatan: String(formData.get("catatan") ?? "").trim() || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    await requireLocationAccess(user, d.locationId);
    // Draft dibuat kalau belum ada — inilah jalur yang membuat hari kosong
    // bisa dilaporkan sama sekali.
    const report = await getOrCreateDraft(d.locationId, d.dateKey, user.id);
    const ctx = await loadReportContext(report.id);

    await setHariNihil(
      ctx.id,
      { nihil: d.nihil, alasan: d.alasan ?? null, catatan: d.catatan ?? null },
      user.id,
    );
    revalidateReport(ctx.slug, ctx.dateKey);

    if (!d.nihil) return { success: "Pernyataan tidak ada kegiatan dibatalkan." };
    /*
     * TIDAK ada tawaran kendala di sini lagi (DECISIONS 407).
     *
     * Dulu jawabannya membawa `usulKendala` dan panel hari-nihil memasang
     * formulir "Catat sebagai kendala" – lalu lembar kirim menanyakan hal yang
     * sama sekali lagi beberapa detik kemudian. Dua pertanyaan untuk satu
     * hambatan: rancu, dan kembarnya lahir dari sana. Usulannya sekarang
     * DIBAWA ke lembar kirim (`judulKendalaDariNihil` dipanggil di layar), jadi
     * hambatan yang sama tetap tidak hilang – hanya ditanyakan satu kali.
     */
    return { success: "Hari ini dinyatakan tidak ada kegiatan." };
  } catch (err) {
    return errState(err);
  }
}
