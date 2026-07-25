import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { PhotoVerification } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { buildPhotoViews } from "@/lib/photos";
import { jakartaDateKey, parseDateKey, formatTanggal } from "@/lib/format";
export { PHOTO_VERIF_LABEL, PHOTO_VERIF_TONE, ALL_VERIFICATIONS, type PhotoTone } from "@/lib/photo-verif";

/**
 * Galeri Foto Lapangan lintas lokasi — SATU tempat melihat semua bukti visual
 * proyek (terhubung ke lokasi, laporan/item pekerjaan atau kegiatan, pelapor,
 * GPS, status verifikasi). Dibatasi ke lokasi yang boleh dilihat user, dan
 * TERPAGINASI (jangan pernah muat ribuan foto sekaligus).
 */

export type GalleryPhoto = {
  id: string;
  thumbUrl?: string;
  fullUrl?: string;
  takenAtIso: string;
  timeLabel: string;
  title: string;
  locationName: string;
  locationSlug: string | null;
  sourceLabel: string;
  reporterName: string;
  hasGps: boolean;
  verification: PhotoVerification;
};

export type GalleryGroup = { key: string; label: string; sublabel: string; photos: GalleryPhoto[] };

export type GalleryData = {
  kpi: { total: number; verified: number; pending: number; issue: number; noGps: number };
  groups: GalleryGroup[];
  count: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  locations: { id: string; name: string }[];
};

export type GalleryFilters = {
  locationId?: string;
  verification?: PhotoVerification;
  source?: "laporan" | "kegiatan";
  q?: string;
  page?: number;
};

const PAGE_SIZE = 96;

function startOfTodayJakarta(): Date {
  return new Date(`${jakartaDateKey(new Date())}T00:00:00+07:00`);
}

export async function getPhotoGallery(locIds: string[] | null, filters: GalleryFilters): Promise<GalleryData> {
  const scope: Prisma.PhotoWhereInput =
    locIds === null
      ? {}
      : { OR: [{ report: { locationId: { in: locIds } } }, { activity: { locationId: { in: locIds } } }] };

  const and: Prisma.PhotoWhereInput[] = [scope];
  if (filters.locationId) {
    and.push({
      OR: [{ report: { locationId: filters.locationId } }, { activity: { locationId: filters.locationId } }],
    });
  }
  if (filters.verification) and.push({ verification: filters.verification });
  if (filters.source === "laporan") and.push({ reportId: { not: null } });
  if (filters.source === "kegiatan") and.push({ activityId: { not: null } });
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    and.push({
      OR: [
        { activity: { title: { contains: q, mode: "insensitive" } } },
        { reportItem: { rabNode: { name: { contains: q, mode: "insensitive" } } } },
        { report: { location: { name: { contains: q, mode: "insensitive" } } } },
        { activity: { location: { name: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  const where: Prisma.PhotoWhereInput = { AND: and };

  const page = Math.max(1, filters.page ?? 1);
  const startToday = startOfTodayJakarta();

  const [rows, count, kToday, kVerified, kPending, kIssue, kNoGps, locations] = await Promise.all([
    db.photo.findMany({
      where,
      orderBy: [{ exifTakenAt: "desc" }, { createdAt: "desc" }],
      take: PAGE_SIZE + 1,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        r2Key: true,
        thumbnailKey: true,
        exifTakenAt: true,
        exifGpsLat: true,
        exifGpsLng: true,
        createdAt: true,
        verification: true,
        uploadedById: true,
        report: { select: { location: { select: { name: true, slug: true } } } },
        reportItem: { select: { rabNode: { select: { name: true } } } },
        activity: { select: { title: true, location: { select: { name: true, slug: true } } } },
      },
    }),
    db.photo.count({ where }),
    db.photo.count({ where: { AND: [scope, { createdAt: { gte: startToday } }] } }),
    db.photo.count({ where: { AND: [scope, { createdAt: { gte: startToday } }, { verification: "passed" }] } }),
    db.photo.count({ where: { AND: [scope, { createdAt: { gte: startToday } }, { verification: "pending" }] } }),
    db.photo.count({ where: { AND: [scope, { activity: { kendala: { not: null } } }] } }),
    db.photo.count({ where: { AND: [scope, { exifGpsLat: null }] } }),
    db.location.findMany({
      where: locIds === null ? { isActive: true } : { id: { in: locIds }, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const hasMore = rows.length > PAGE_SIZE;
  if (hasMore) rows.pop();

  // Nama pelapor (batch).
  const uploaderIds = [...new Set(rows.map((r) => r.uploadedById).filter((v): v is string => !!v))];
  const uploaders = uploaderIds.length
    ? await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, fullName: true } })
    : [];
  const uploaderName = new Map(uploaders.map((u) => [u.id, u.fullName]));

  const views = await buildPhotoViews(rows);
  const viewById = new Map(views.map((v) => [v.id, v]));

  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  });

  const photos: GalleryPhoto[] = rows.map((r) => {
    const takenAt = r.exifTakenAt ?? r.createdAt;
    const v = viewById.get(r.id);
    return {
      id: r.id,
      thumbUrl: v?.thumbUrl,
      fullUrl: v?.fullUrl,
      takenAtIso: takenAt.toISOString(),
      timeLabel: timeFmt.format(takenAt),
      title: r.reportItem?.rabNode.name ?? r.activity?.title ?? "Foto lapangan",
      locationName: r.report?.location.name ?? r.activity?.location.name ?? "—",
      locationSlug: r.report?.location.slug ?? r.activity?.location.slug ?? null,
      sourceLabel: r.report ? "Laporan Harian" : "Kegiatan Lapangan",
      reporterName: (r.uploadedById && uploaderName.get(r.uploadedById)) || "—",
      hasGps: r.exifGpsLat != null,
      verification: r.verification,
    };
  });

  // Kelompokkan per tanggal (Hari Ini / Kemarin / tanggal).
  const todayKey = jakartaDateKey(new Date());
  const yesterdayKey = jakartaDateKey(new Date(Date.now() - 86_400_000));
  const groupMap = new Map<string, GalleryPhoto[]>();
  for (const p of photos) {
    const key = jakartaDateKey(new Date(p.takenAtIso));
    (groupMap.get(key) ?? groupMap.set(key, []).get(key)!).push(p);
  }
  const groups: GalleryGroup[] = [...groupMap.entries()].map(([key, ps]) => {
    const label = key === todayKey ? "Hari Ini" : key === yesterdayKey ? "Kemarin" : formatTanggal(parseDateKey(key)!);
    return { key, label, sublabel: `${formatTanggal(parseDateKey(key)!)} · ${ps.length} foto`, photos: ps };
  });

  return {
    kpi: { total: kToday, verified: kVerified, pending: kPending, issue: kIssue, noGps: kNoGps },
    groups,
    count,
    page,
    pageSize: PAGE_SIZE,
    hasMore,
    locations,
  };
}
