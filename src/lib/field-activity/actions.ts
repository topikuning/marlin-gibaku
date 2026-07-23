"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { MAX_PHOTOS_PER_UPLOAD, PhotoError, savePhotoForItem } from "@/lib/photos";
import { isR2Configured, r2Delete, r2Put } from "@/lib/r2";
import { ALLOWED_UPLOAD_MIMES, MAX_UPLOAD_BYTES } from "@/lib/documents-meta";
import { jakartaDateKey } from "@/lib/format";

/** Hapus objek R2 (best-effort — orphan diabaikan bila gagal). */
async function deleteR2Keys(keys: (string | null | undefined)[]): Promise<void> {
  if (!isR2Configured()) return;
  await Promise.all(
    keys.filter((k): k is string => !!k).map((k) => r2Delete(k).catch(() => {})),
  );
}

export type FieldActivityState = { error?: string; success?: string; warning?: string } | undefined;

function fail(err: unknown): FieldActivityState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

function revalidate(slug: string): void {
  revalidatePath(`/lokasi/${slug}/kegiatan`);
  revalidatePath(`/lokasi/${slug}`);
}

/** Ambil lokasi + nama perusahaan (utk cap foto). */
async function locationForStamp(locationId: string) {
  return db.location.findUnique({
    where: { id: locationId },
    select: {
      slug: true,
      name: true,
      package: {
        select: {
          organization: { select: { name: true } },
          contract: { select: { vendor: { select: { name: true } } } },
        },
      },
    },
  });
}

/** Unggah kumpulan foto ke satu kegiatan (best-effort; kumpulkan error). */
async function uploadPhotos(opts: {
  files: File[];
  activityId: string;
  userId: string;
  reporterName: string;
  location: { slug: string; name: string };
  companyName: string | null;
  dateKey: string;
  lat: number | null;
  lng: number | null;
  takenAt: Date | null;
}): Promise<string[]> {
  const errors: string[] = [];
  for (const file of opts.files.slice(0, MAX_PHOTOS_PER_UPLOAD)) {
    try {
      await savePhotoForItem({
        activityId: opts.activityId,
        file,
        userId: opts.userId,
        locationSlug: opts.location.slug,
        dateKey: opts.dateKey,
        stamp: {
          lat: opts.lat,
          lng: opts.lng,
          takenAt: opts.takenAt,
          locationLabel: opts.location.name,
          companyName: opts.companyName,
          reporterName: opts.reporterName,
        },
      });
    } catch (err) {
      if (err instanceof PhotoError) errors.push(err.message);
      else throw err;
    }
  }
  return errors;
}

function filesFrom(formData: FormData): File[] {
  return formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
}

function parseTakenAt(v: FormDataEntryValue | null): Date | null {
  if (!v) return null;
  const t = new Date(String(v));
  return Number.isNaN(t.getTime()) ? null : t;
}

const createSchema = z.object({
  locationId: z.uuid(),
  type: z.enum([
    "rapat_pcm",
    "pengukuran_uitzet",
    "mc0",
    "sosialisasi",
    "mobilisasi",
    "dokumentasi_0",
    "lainnya",
  ]),
  activityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid"),
  title: z.string().trim().min(3, "Judul minimal 3 karakter").max(160),
  notes: z.string().trim().max(2000).optional(),
  participants: z.string().trim().max(500).optional(),
  gpsLat: z.coerce.number().min(-90).max(90).optional(),
  gpsLng: z.coerce.number().min(-180).max(180).optional(),
});

/** Buat kegiatan lapangan baru (status draft) + unggah foto awal (opsional). */
export async function createActivityAction(
  _prev: FieldActivityState,
  formData: FormData,
): Promise<FieldActivityState> {
  const parsed = createSchema.safeParse({
    locationId: formData.get("locationId"),
    type: formData.get("type"),
    activityDate: formData.get("activityDate"),
    title: formData.get("title"),
    notes: formData.get("notes") || undefined,
    participants: formData.get("participants") || undefined,
    gpsLat: formData.get("gpsLat") || undefined,
    gpsLng: formData.get("gpsLng") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("field_activity.manage");
    await requireLocationAccess(user, d.locationId);
    const location = await locationForStamp(d.locationId);
    if (!location) return { error: "Lokasi tidak ditemukan." };

    const activity = await db.fieldActivity.create({
      data: {
        locationId: d.locationId,
        activityDate: new Date(`${d.activityDate}T00:00:00.000Z`),
        type: d.type,
        title: d.title,
        notes: d.notes ?? null,
        participants: d.participants ?? null,
        gpsLat: d.gpsLat != null ? d.gpsLat.toFixed(7) : null,
        gpsLng: d.gpsLng != null ? d.gpsLng.toFixed(7) : null,
        status: "draft",
        createdById: user.id,
      },
    });

    const photoErrors = await uploadPhotos({
      files: filesFrom(formData),
      activityId: activity.id,
      userId: user.id,
      reporterName: user.fullName,
      location,
      companyName:
        location.package?.contract?.vendor?.name ?? location.package?.organization?.name ?? null,
      dateKey: d.activityDate,
      lat: d.gpsLat ?? null,
      lng: d.gpsLng ?? null,
      takenAt: parseTakenAt(formData.get("photoTakenAt")),
    });

    await audit(user.id, "field_activity.create", "field_activity", activity.id, {
      locationId: d.locationId,
      type: d.type,
    });
    revalidate(location.slug);
    return {
      success: "Kegiatan tersimpan (draft).",
      warning: photoErrors.length ? `Sebagian foto gagal: ${[...new Set(photoErrors)].join("; ")}` : undefined,
    };
  } catch (err) {
    return fail(err);
  }
}

/** Ambil kegiatan + slug lokasi utk otorisasi/revalidate. */
async function activityCtx(activityId: string) {
  return db.fieldActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      status: true,
      locationId: true,
      activityDate: true,
      location: {
        select: {
          slug: true,
          name: true,
          package: {
            select: {
              organization: { select: { name: true } },
              contract: { select: { vendor: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
}

/** Tambah foto ke kegiatan yang masih draft. */
export async function addActivityPhotosAction(
  _prev: FieldActivityState,
  formData: FormData,
): Promise<FieldActivityState> {
  const idParse = z.uuid().safeParse(formData.get("activityId"));
  if (!idParse.success) return { error: "Kegiatan tidak valid." };
  try {
    const user = await requireCapability("field_activity.manage");
    const ctx = await activityCtx(idParse.data);
    if (!ctx) return { error: "Kegiatan tidak ditemukan." };
    await requireLocationAccess(user, ctx.locationId);
    if (ctx.status !== "draft") return { error: "Kegiatan sudah final — tidak bisa ditambah foto." };

    const files = filesFrom(formData);
    if (!files.length) return { error: "Tidak ada foto untuk diunggah." };
    const dateKey = ctx.activityDate.toISOString().slice(0, 10);
    const photoErrors = await uploadPhotos({
      files,
      activityId: ctx.id,
      userId: user.id,
      reporterName: user.fullName,
      location: ctx.location,
      companyName:
        ctx.location.package?.contract?.vendor?.name ?? ctx.location.package?.organization?.name ?? null,
      dateKey,
      lat: null,
      lng: null,
      takenAt: parseTakenAt(formData.get("photoTakenAt")),
    });
    revalidate(ctx.location.slug);
    if (photoErrors.length) return { warning: `Sebagian foto gagal: ${[...new Set(photoErrors)].join("; ")}` };
    return { success: "Foto ditambahkan." };
  } catch (err) {
    return fail(err);
  }
}

/** Finalkan kegiatan (draft → final). Setelah final tidak bisa diubah. */
export async function finalizeActivityAction(
  _prev: FieldActivityState,
  formData: FormData,
): Promise<FieldActivityState> {
  const idParse = z.uuid().safeParse(formData.get("activityId"));
  if (!idParse.success) return { error: "Kegiatan tidak valid." };
  try {
    const user = await requireCapability("field_activity.manage");
    const ctx = await activityCtx(idParse.data);
    if (!ctx) return { error: "Kegiatan tidak ditemukan." };
    await requireLocationAccess(user, ctx.locationId);
    if (ctx.status === "final") return { error: "Kegiatan sudah final." };

    await db.fieldActivity.update({
      where: { id: ctx.id },
      data: { status: "final", finalizedById: user.id, finalizedAt: new Date() },
    });
    await audit(user.id, "field_activity.finalize", "field_activity", ctx.id, { locationId: ctx.locationId });
    revalidate(ctx.location.slug);
    return { success: "Kegiatan difinalkan." };
  } catch (err) {
    return fail(err);
  }
}

/** Hapus kegiatan (hanya draft) beserta baris fotonya. */
export async function deleteActivityAction(
  _prev: FieldActivityState,
  formData: FormData,
): Promise<FieldActivityState> {
  const idParse = z.uuid().safeParse(formData.get("activityId"));
  if (!idParse.success) return { error: "Kegiatan tidak valid." };
  try {
    const user = await requireCapability("field_activity.manage");
    const ctx = await activityCtx(idParse.data);
    if (!ctx) return { error: "Kegiatan tidak ditemukan." };
    await requireLocationAccess(user, ctx.locationId);
    if (ctx.status === "final") return { error: "Kegiatan final tidak bisa dihapus — buka kembali dulu bila perlu koreksi." };

    const [photos, attachments] = await Promise.all([
      db.photo.findMany({ where: { activityId: ctx.id }, select: { r2Key: true, thumbnailKey: true } }),
      db.fieldActivityAttachment.findMany({ where: { activityId: ctx.id }, select: { r2Key: true } }),
    ]);
    await db.$transaction([
      db.photo.deleteMany({ where: { activityId: ctx.id } }),
      db.fieldActivityAttachment.deleteMany({ where: { activityId: ctx.id } }),
      db.fieldActivity.delete({ where: { id: ctx.id } }),
    ]);
    await deleteR2Keys([
      ...photos.flatMap((p) => [p.r2Key, p.thumbnailKey]),
      ...attachments.map((a) => a.r2Key),
    ]);
    await audit(user.id, "field_activity.delete", "field_activity", ctx.id, { locationId: ctx.locationId });
    revalidate(ctx.location.slug);
    return { success: "Kegiatan dihapus." };
  } catch (err) {
    return fail(err);
  }
}

/** Hapus satu foto dari kegiatan draft (DB + objek R2). */
export async function removeActivityPhotoAction(
  _prev: FieldActivityState,
  formData: FormData,
): Promise<FieldActivityState> {
  const idParse = z.uuid().safeParse(formData.get("photoId"));
  if (!idParse.success) return { error: "Foto tidak valid." };
  try {
    const user = await requireCapability("field_activity.manage");
    const photo = await db.photo.findUnique({
      where: { id: idParse.data },
      select: {
        id: true,
        r2Key: true,
        thumbnailKey: true,
        activity: { select: { id: true, status: true, locationId: true, location: { select: { slug: true } } } },
      },
    });
    if (!photo?.activity) return { error: "Foto kegiatan tidak ditemukan." };
    await requireLocationAccess(user, photo.activity.locationId);
    if (photo.activity.status === "final") return { error: "Kegiatan sudah final — buka kembali dulu untuk menghapus foto." };

    await db.photo.delete({ where: { id: photo.id } });
    await deleteR2Keys([photo.r2Key, photo.thumbnailKey]);
    revalidate(photo.activity.location.slug);
    return { success: "Foto dihapus." };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------------ */
/* Lampiran dokumen (non-foto): PDF/Word/Excel/gambar                   */
/* Ringkas — menempel ke kegiatan, TIDAK masuk Document Center formal.  */
/* ------------------------------------------------------------------ */

const MAX_ATTACHMENTS_PER_UPLOAD = 6;

/** Nama file aman untuk key R2 (whitelist karakter, pertahankan ekstensi). */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "");
  return (cleaned || "berkas").slice(-80);
}

/** Tambah lampiran dokumen ke kegiatan draft (best-effort per berkas). */
export async function addActivityAttachmentsAction(
  _prev: FieldActivityState,
  formData: FormData,
): Promise<FieldActivityState> {
  const idParse = z.uuid().safeParse(formData.get("activityId"));
  if (!idParse.success) return { error: "Kegiatan tidak valid." };
  try {
    const user = await requireCapability("field_activity.manage");
    const ctx = await activityCtx(idParse.data);
    if (!ctx) return { error: "Kegiatan tidak ditemukan." };
    await requireLocationAccess(user, ctx.locationId);
    if (ctx.status !== "draft") return { error: "Kegiatan sudah final — tidak bisa ditambah lampiran." };
    if (!isR2Configured()) {
      return { error: "Penyimpanan file (R2) belum dikonfigurasi — unggah lampiran dinonaktifkan." };
    }

    const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) return { error: "Tidak ada dokumen untuk diunggah." };

    const errors: string[] = [];
    let saved = 0;
    const yyyy = jakartaDateKey(new Date()).slice(0, 4);
    for (const file of files.slice(0, MAX_ATTACHMENTS_PER_UPLOAD)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        errors.push(`${file.name}: ukuran ${(file.size / 1024 / 1024).toFixed(1)} MB melebihi 15 MB`);
        continue;
      }
      if (!ALLOWED_UPLOAD_MIMES[file.type]) {
        errors.push(`${file.name}: jenis file tidak didukung (${file.type || "tidak dikenal"})`);
        continue;
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      // Dedup per kegiatan (bukan per org — lampiran boleh sama antar kegiatan).
      const dupe = await db.fieldActivityAttachment.findFirst({
        where: { activityId: ctx.id, sha256 },
        select: { fileName: true },
      });
      if (dupe) {
        errors.push(`${file.name}: identik dengan "${dupe.fileName}" yang sudah ada`);
        continue;
      }
      const r2Key = `activity-attachments/${yyyy}/${randomUUID()}-${sanitizeFileName(file.name)}`;
      await r2Put(r2Key, buffer, file.type);
      await db.fieldActivityAttachment.create({
        data: {
          activityId: ctx.id,
          r2Key,
          fileName: file.name.slice(0, 200),
          mimeType: file.type,
          bytes: file.size,
          sha256,
          uploadedById: user.id,
        },
      });
      saved++;
    }

    await audit(user.id, "field_activity.attachment_add", "field_activity", ctx.id, {
      locationId: ctx.locationId,
      saved,
    });
    revalidate(ctx.location.slug);
    if (saved === 0) return { error: errors.join("; ") || "Tidak ada lampiran tersimpan." };
    return {
      success: `${saved} lampiran ditambahkan.`,
      warning: errors.length ? `Sebagian gagal: ${errors.join("; ")}` : undefined,
    };
  } catch (err) {
    return fail(err);
  }
}

/** Hapus satu lampiran dari kegiatan draft (DB + objek R2). */
export async function removeActivityAttachmentAction(
  _prev: FieldActivityState,
  formData: FormData,
): Promise<FieldActivityState> {
  const idParse = z.uuid().safeParse(formData.get("attachmentId"));
  if (!idParse.success) return { error: "Lampiran tidak valid." };
  try {
    const user = await requireCapability("field_activity.manage");
    const att = await db.fieldActivityAttachment.findUnique({
      where: { id: idParse.data },
      select: {
        id: true,
        r2Key: true,
        activity: { select: { status: true, locationId: true, location: { select: { slug: true } } } },
      },
    });
    if (!att?.activity) return { error: "Lampiran tidak ditemukan." };
    await requireLocationAccess(user, att.activity.locationId);
    if (att.activity.status === "final") return { error: "Kegiatan sudah final — buka kembali dulu untuk menghapus lampiran." };

    await db.fieldActivityAttachment.delete({ where: { id: att.id } });
    await deleteR2Keys([att.r2Key]);
    revalidate(att.activity.location.slug);
    return { success: "Lampiran dihapus." };
  } catch (err) {
    return fail(err);
  }
}

/** Buka kembali kegiatan final → draft (untuk koreksi foto/isi), gate + audit. */
export async function reopenActivityAction(
  _prev: FieldActivityState,
  formData: FormData,
): Promise<FieldActivityState> {
  const idParse = z.uuid().safeParse(formData.get("activityId"));
  if (!idParse.success) return { error: "Kegiatan tidak valid." };
  try {
    const user = await requireCapability("field_activity.manage");
    const ctx = await activityCtx(idParse.data);
    if (!ctx) return { error: "Kegiatan tidak ditemukan." };
    await requireLocationAccess(user, ctx.locationId);
    if (ctx.status !== "final") return { error: "Hanya kegiatan final yang perlu dibuka kembali." };

    await db.fieldActivity.update({
      where: { id: ctx.id },
      data: { status: "draft", finalizedById: null, finalizedAt: null },
    });
    await audit(user.id, "field_activity.reopen", "field_activity", ctx.id, { locationId: ctx.locationId });
    revalidate(ctx.location.slug);
    return { success: "Kegiatan dibuka kembali (draft) — bisa dikoreksi lalu difinalkan lagi." };
  } catch (err) {
    return fail(err);
  }
}
