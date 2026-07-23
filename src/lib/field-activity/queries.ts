import "server-only";
import { db } from "@/lib/db";
import { buildPhotoViews, type PhotoView } from "@/lib/photos";
import type { FieldActivityStatus, FieldActivityType } from "@/generated/prisma/enums";

export type FieldActivityView = {
  id: string;
  activityDate: string; // ISO date (yyyy-mm-dd)
  type: FieldActivityType;
  title: string;
  notes: string | null;
  participants: string | null;
  status: FieldActivityStatus;
  createdByName: string | null;
  photos: PhotoView[];
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
      status: true,
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
    status: r.status,
    createdByName: nameById.get(r.createdById) ?? null,
    photos: r.photos.map((p) => byId.get(p.id)).filter((v): v is PhotoView => v != null),
  }));
}
