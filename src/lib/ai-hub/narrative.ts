import "server-only";
import { db } from "@/lib/db";
import { parseDateKey } from "@/lib/format";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import type { SessionUser } from "@/lib/auth/session";
import { truncateText, type NarrativeActivity, type NarrativeBundle, type NarrativeReport } from "./narrative-format";

export * from "./narrative-format";

/**
 * Narasi lapangan — teks catatan laporan harian & kegiatan lapangan (BUKAN
 * angka progres) sebagai KONTEKS untuk AI menjelaskan "apa yang terjadi",
 * bukan hanya angka. AI hanya boleh MENGUTIP, tidak mengubah makna. Foto TIDAK
 * dikirim sebagai gambar ke provider (vision/OCR sengaja tidak dibangun —
 * DECISIONS 133 §17); hanya jumlah + tautan drill-down. DECISIONS 136.
 *
 * Fetch DB di sini (server-only); formatter/tipe MURNI ada di narrative-format.ts
 * supaya bisa diimpor modul lain (prompt.ts) dan diuji unit tanpa environment DB.
 */

const REPORTS_PER_LOCATION = 6;
const ACTIVITIES_PER_LOCATION = 8;
const ITEMS_PER_REPORT = 6;

/**
 * Ambil narasi (laporan harian + kegiatan lapangan) untuk lokasi dalam scope,
 * dibatasi periode & jumlah entri per lokasi (anti-ledak token). Menerima
 * meta lokasi (id/nama/slug) dari pemanggil supaya tidak query Location dua kali.
 */
export async function buildNarrativeBundle(
  user: SessionUser,
  locations: { id: string; name: string; slug: string }[],
  startKey: string,
  endKey: string,
): Promise<NarrativeBundle> {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  const locIds = locations.map((l) => l.id);
  if (!start || !end || locIds.length === 0) return { locations: [] };

  const [reportsRaw, activitiesRaw, kindMap] = await Promise.all([
    db.dailyReport.findMany({
      where: { locationId: { in: locIds }, reportDate: { gte: start, lte: end }, location: { package: { orgId: user.orgId } } },
      orderBy: [{ locationId: "asc" }, { reportDate: "desc" }],
      take: 3000,
      select: {
        id: true,
        locationId: true,
        reportDate: true,
        status: true,
        weather: true,
        notes: true,
        _count: { select: { photos: true } },
        items: {
          take: ITEMS_PER_REPORT,
          orderBy: { createdAt: "asc" },
          select: { volumeDone: true, notes: true, rabNode: { select: { name: true, unit: true } } },
        },
      },
    }),
    db.fieldActivity.findMany({
      where: { locationId: { in: locIds }, activityDate: { gte: start, lte: end }, location: { package: { orgId: user.orgId } } },
      orderBy: [{ locationId: "asc" }, { activityDate: "desc" }],
      take: 3000,
      select: {
        id: true,
        locationId: true,
        activityDate: true,
        type: true,
        title: true,
        notes: true,
        kendala: true,
        solusi: true,
        status: true,
        _count: { select: { photos: true } },
      },
    }),
    getActivityKindLabelMap(),
  ]);

  const reportsByLoc = new Map<string, NarrativeReport[]>();
  for (const r of reportsRaw) {
    const arr = reportsByLoc.get(r.locationId) ?? [];
    if (arr.length >= REPORTS_PER_LOCATION) continue;
    arr.push({
      id: r.id,
      date: r.reportDate.toISOString().slice(0, 10),
      status: r.status,
      weather: r.weather,
      notes: truncateText(r.notes),
      photoCount: r._count.photos,
      items: r.items.map((it) => ({
        itemName: it.rabNode.name,
        unit: it.rabNode.unit,
        volumeDone: Number(it.volumeDone),
        notes: truncateText(it.notes, 120),
      })),
    });
    reportsByLoc.set(r.locationId, arr);
  }

  const activitiesByLoc = new Map<string, NarrativeActivity[]>();
  for (const a of activitiesRaw) {
    const arr = activitiesByLoc.get(a.locationId) ?? [];
    if (arr.length >= ACTIVITIES_PER_LOCATION) continue;
    arr.push({
      id: a.id,
      date: a.activityDate.toISOString().slice(0, 10),
      kindLabel: kindMap.get(a.type) ?? a.type,
      title: a.title,
      notes: truncateText(a.notes),
      kendala: truncateText(a.kendala),
      solusi: truncateText(a.solusi),
      status: a.status,
      photoCount: a._count.photos,
    });
    activitiesByLoc.set(a.locationId, arr);
  }

  return {
    locations: locations.map((l) => ({
      locationId: l.id,
      locationName: l.name,
      slug: l.slug,
      reports: reportsByLoc.get(l.id) ?? [],
      activities: activitiesByLoc.get(l.id) ?? [],
    })),
  };
}
