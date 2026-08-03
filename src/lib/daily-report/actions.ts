"use server";

import { revalidatePath } from "next/cache";
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
import { audit } from "@/lib/audit";
import { applyWeatherToReport, WeatherError, WeatherFetchError } from "@/lib/weather/service";
import type { UserRole, WeatherCode, WorkerRole } from "@/generated/prisma/enums";
import { WEATHER_ORDER, WORKER_ROLE_ORDER } from "./constants";
import {
  addIssueFromReport,
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
  | { error?: string; success?: string; warning?: string }
  | undefined;

function errState(err: unknown): DailyActionState {
  if (err instanceof DailyReportError || err instanceof PhotoError || err instanceof ForbiddenError) {
    return { error: err.message };
  }
  throw err;
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
          contract: { select: { vendor: { select: { name: true } } } },
        },
      },
    },
  });
  if (!location) throw new DailyReportError("Lokasi tidak ditemukan");
  return {
    location,
    companyName:
      location.package?.contract?.vendor?.name ?? location.package?.organization?.name ?? null,
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
async function unggahFotoItem(p: {
  user: SessionUser;
  location: Awaited<ReturnType<typeof muatLokasiCap>>["location"];
  companyName: string | null;
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

    revalidateReport(location.slug, d.dateKey);
    return {
      success: "Progres tersimpan.",
      warning: photoErrors.length ? `Sebagian foto gagal: ${[...new Set(photoErrors)].join("; ")}` : undefined,
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
      return { error: "Laporan sudah dikirim — foto tidak bisa ditambah lagi." };
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
      return { error: "Laporan sudah dikirim — data KKP dilengkapi oleh Site Manager saat verifikasi." };
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
        (hujan > 0 ? ` — ${hujan} jam hujan.` : " — tidak ada jam hujan.") +
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
      return { error: "Laporan sudah dikirim — data KKP dilengkapi oleh Site Manager saat verifikasi." };
    }

    const workers = WORKER_ROLE_ORDER.map((role: WorkerRole) => ({
      role,
      count: Math.max(0, Math.trunc(Number(formData.get(`worker_${role}`) ?? 0)) || 0),
    }));
    const materialNames = formData.getAll("materialName").map(String);
    const materialUnits = formData.getAll("materialUnit").map(String);
    const materialQtys = formData.getAll("materialQty").map(String);
    const materials = materialNames.map((name, i) => ({
      name,
      unit: materialUnits[i] || null,
      qty: materialQtys[i] ? Number(materialQtys[i]) : null,
    }));
    const equipmentNames = formData.getAll("equipmentName").map(String);
    const equipmentCounts = formData.getAll("equipmentCount").map(String);
    const equipment = equipmentNames.map((name, i) => ({
      name,
      count: Math.max(1, Math.trunc(Number(equipmentCounts[i] ?? 1)) || 1),
    }));

    await setEnrichment(
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
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Pelengkap laporan tersimpan." };
  } catch (err) {
    return errState(err);
  }
}

// ─────────────────────────────────────────────────────────────
// Transisi status
// ─────────────────────────────────────────────────────────────

export async function submitReportAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.create");
    const reportId = z.uuid().parse(formData.get("reportId"));
    const ctx = await loadReportContext(reportId);
    await requireLocationAccess(user, ctx.locationId);
    await submitReport(reportId, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Laporan terkirim — menunggu verifikasi." };
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

export async function finalizeReportAction(_prev: DailyActionState, formData: FormData): Promise<DailyActionState> {
  try {
    const user = await requireCapability("daily_report.finalize");
    const reportId = z.uuid().parse(formData.get("reportId"));
    const ctx = await loadReportContext(reportId);
    await requireLocationAccess(user, ctx.locationId);
    await finalizeReport(reportId, user.id);
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Laporan difinalisasi — siap dicetak." };
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

// ─────────────────────────────────────────────────────────────
// Kendala (Issue) dari laporan
// ─────────────────────────────────────────────────────────────

const issueSchema = z.object({
  reportId: z.uuid(),
  title: z.string().trim().min(3, "Judul kendala wajib diisi (min 3 karakter)").max(200),
  description: z.string().trim().max(2000).optional(),
  severity: z.enum(["rendah", "sedang", "tinggi", "kritis"]),
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
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const ctx = await loadReportContext(parsed.data.reportId);
    await requireLocationAccess(user, ctx.locationId);
    await addIssueFromReport(
      ctx.id,
      {
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        severity: parsed.data.severity,
      },
      user.id,
    );
    revalidateReport(ctx.slug, ctx.dateKey);
    return { success: "Kendala tercatat." };
  } catch (err) {
    return errState(err);
  }
}
