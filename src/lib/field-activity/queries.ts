import "server-only";
import { db } from "@/lib/db";
import { buildPhotoViews, type PhotoView } from "@/lib/photos";
import type { FieldActivityStatus } from "@/generated/prisma/enums";

export type FieldActivityAttachmentView = {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: number;
};

export type FieldActivityView = {
  id: string;
  activityDate: string; // ISO date (yyyy-mm-dd)
  type: string;
  title: string;
  notes: string | null;
  participants: string | null;
  kendala: string | null;
  solusi: string | null;
  status: FieldActivityStatus;
  waSentAt: string | null;
  createdByName: string | null;
  photos: PhotoView[];
  attachments: FieldActivityAttachmentView[];
};

/** Daftar kegiatan lapangan sebuah lokasi (terbaru dulu) + foto terpresign. */
export async function listFieldActivities(locationId: string): Promise<FieldActivityView[]> {
  const rows = await db.fieldActivity.findMany({
    where: { locationId },
    orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      activityDate: true,
      type: true,
      title: true,
      notes: true,
      participants: true,
      kendala: true,
      solusi: true,
      status: true,
      waSentAt: true,
      createdById: true,
      photos: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          r2Key: true,
          thumbnailKey: true,
          exifTakenAt: true,
          exifGpsLat: true,
          exifGpsLng: true,
        },
      },
      attachments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, fileName: true, mimeType: true, bytes: true },
      },
    },
  });

  // Nama pembuat (tanpa relasi FK — konsisten dgn DailyReport.createdById).
  const creatorIds = [...new Set(rows.map((r) => r.createdById))];
  const creators = await db.user.findMany({
    where: { id: { in: creatorIds } },
    select: { id: true, fullName: true },
  });
  const nameById = new Map(creators.map((u) => [u.id, u.fullName]));

  // Presign semua foto sekaligus (satu batch) → view.
  const allPhotos = rows.flatMap((r) => r.photos);
  const views = await buildPhotoViews(allPhotos);
  const byId = new Map(views.map((v) => [v.id, v]));

  return rows.map((r) => ({
    id: r.id,
    activityDate: r.activityDate.toISOString().slice(0, 10),
    type: r.type,
    title: r.title,
    notes: r.notes,
    participants: r.participants,
    kendala: r.kendala,
    solusi: r.solusi,
    status: r.status,
    waSentAt: r.waSentAt?.toISOString() ?? null,
    createdByName: nameById.get(r.createdById) ?? null,
    photos: r.photos.map((p) => byId.get(p.id)).filter((v): v is PhotoView => v != null),
    attachments: r.attachments,
  }));
}
