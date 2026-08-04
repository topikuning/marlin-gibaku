import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { buildPhotoViews } from "@/lib/photos";
import { jakartaDateKey, parseDateKey, formatTanggal } from "@/lib/format";
import {
  deriveStatusFoto,
  STATUS_KEGIATAN_TERVERIFIKASI,
  STATUS_LAPORAN_TERVERIFIKASI,
  type PhotoStatus,
} from "@/lib/photo-status";
export {
  PHOTO_STATUS_LABEL,
  PHOTO_STATUS_TONE,
  PHOTO_STATUS_ORDER,
  type PhotoStatus,
  type PhotoStatusTone,
} from "@/lib/photo-status";

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
  /** GPS ASLI foto (EXIF / perangkat) — cadangan titik proyek TIDAK dihitung. */
  hasGps: boolean;
  /** Koordinat yang tercap berasal dari titik lokasi proyek, bukan dari foto. */
  gpsFromProject: boolean;
  /** Ada arsip berkas asli (tanpa cap) yang bisa diunduh. */
  hasOriginal: boolean;
  /** DITURUNKAN dari status laporan/kegiatan induknya — bukan kolom tersimpan. */
  status: PhotoStatus;
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
  status?: PhotoStatus;
  /**
   * Sumbu TERPISAH dari status. Dulu "Tanpa GPS" jadi salah satu nilai
   * `verification`, sehingga chip-nya menyaring `flagged_gps` — nilai yang
   * tidak pernah ditulis siapa pun — dan SELALU memberi nol hasil walau kartu
   * KPI di atasnya menyebut ratusan. Sekarang chip dan kartu memakai definisi
   * yang sama persis: `gpsSource` bukan exif/device (DECISIONS 250).
   */
  tanpaGps?: boolean;
  source?: "laporan" | "kegiatan";
  q?: string;
  page?: number;
};

/** Foto yang induknya sudah disetujui/final — dipakai filter DAN KPI. */
const WHERE_TERVERIFIKASI: Prisma.PhotoWhereInput = {
  OR: [
    { report: { status: { in: STATUS_LAPORAN_TERVERIFIKASI } } },
    { AND: [{ reportId: null }, { activity: { status: { in: STATUS_KEGIATAN_TERVERIFIKASI } } }] },
  ],
};

/** Definisi TUNGGAL "tanpa GPS" — cadangan titik proyek bukan bukti posisi. */
const WHERE_TANPA_GPS: Prisma.PhotoWhereInput = { gpsSource: { notIn: ["exif", "device"] } };

function whereStatus(status: PhotoStatus): Prisma.PhotoWhereInput {
  switch (status) {
    case "terverifikasi":
      return WHERE_TERVERIFIKASI;
    case "menunggu_review":
      return { report: { status: "dikirim" } };
    case "perlu_koreksi":
      return { report: { status: "perlu_koreksi" } };
    case "draft":
      return {
        OR: [
          { report: { status: "draft" } },
          { AND: [{ reportId: null }, { activity: { status: "draft" } }] },
        ],
      };
    case "lepas":
      return { AND: [{ reportId: null }, { activityId: null }] };
  }
}

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
  if (filters.status) and.push(whereStatus(filters.status));
  if (filters.tanpaGps) and.push(WHERE_TANPA_GPS);
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
        gpsSource: true,
        originalKey: true,
        createdAt: true,
        uploadedById: true,
        report: { select: { status: true, location: { select: { name: true, slug: true } } } },
        reportItem: { select: { rabNode: { select: { name: true } } } },
        activity: {
          select: { title: true, status: true, location: { select: { name: true, slug: true } } },
        },
      },
    }),
    db.photo.count({ where }),
    db.photo.count({ where: { AND: [scope, { createdAt: { gte: startToday } }] } }),
    db.photo.count({ where: { AND: [scope, { createdAt: { gte: startToday } }, WHERE_TERVERIFIKASI] } }),
    db.photo.count({
      where: { AND: [scope, { createdAt: { gte: startToday } }, whereStatus("menunggu_review")] },
    }),
    db.photo.count({ where: { AND: [scope, { activity: { kendala: { not: null } } }] } }),
    // "Tanpa GPS" = tanpa koordinat ASLI foto; cadangan titik proyek ikut
    // terhitung di sini karena bukan bukti posisi (DECISIONS 197).
    db.photo.count({ where: { AND: [scope, WHERE_TANPA_GPS] } }),
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
      hasGps: r.gpsSource === "exif" || r.gpsSource === "device",
      gpsFromProject: r.gpsSource === "project",
      hasOriginal: r.originalKey != null,
      status: deriveStatusFoto({
        reportStatus: r.report?.status,
        activityStatus: r.activity?.status,
      }),
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
