import { db } from "@/lib/db";
import { getLocationProgress } from "@/lib/progress";
import { getWeeklySuggestions } from "@/lib/scurve-plan";
import { getActiveLineages } from "@/lib/rab";
import { presignKeys } from "@/lib/photos";

export type PetaMarker = {
  id: string;
  slug: string;
  name: string;
  province: string;
  regency: string;
  status: string;
  lat: number;
  lon: number;
};

export type LocationSnapshot = {
  name: string;
  slug: string;
  province: string;
  regency: string;
  village: string;
  status: string;
  contractor: string;
  contractNumber: string;
  realizedPct: number;
  planPct: number;
  deviationPct: number;
  weekNumber: number;
  totalWeeks: number;
  phase: { key: string; label: string; pct: number }[];
  photos: { id: string; url: string | null }[];
};

/** Titik lokasi untuk peta (yang punya koordinat). */
export async function getPetaMarkers(
  locations: { id: string; slug: string; name: string; province: string; regency: string; status: string; gpsLat: unknown; gpsLng: unknown }[]
): Promise<PetaMarker[]> {
  const out: PetaMarker[] = [];
  for (const l of locations) {
    const lat = Number(l.gpsLat);
    const lon = Number(l.gpsLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      id: l.id,
      slug: l.slug,
      name: l.name,
      province: l.province,
      regency: l.regency,
      status: l.status,
      lat,
      lon,
    });
  }
  return out;
}

/** Ringkasan 1 lokasi saat titik peta diklik: progress + fase minggu ini + foto. */
export async function getLocationSnapshot(locationId: string): Promise<LocationSnapshot | null> {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: {
      name: true,
      slug: true,
      province: true,
      regency: true,
      village: true,
      status: true,
      contract: {
        select: { startDate: true, contractNumber: true, contractor: { select: { name: true } } },
      },
    },
  });
  if (!loc) return null;

  const [progress, sugg, lineages] = await Promise.all([
    getLocationProgress(locationId, loc.contract.startDate),
    getWeeklySuggestions(locationId),
    getActiveLineages(locationId),
  ]);

  const phase = sugg.weekly.find((w) => w.week === progress.weekNumber)?.trades ?? [];

  const photoRows = lineages.length
    ? await db.photo.findMany({
        where: { reportItem: { rabItem: { lineageId: { in: lineages } } } },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, r2Key: true },
      })
    : [];
  const urls = await presignKeys(photoRows.map((p) => p.r2Key));

  return {
    name: loc.name,
    slug: loc.slug,
    province: loc.province,
    regency: loc.regency,
    village: loc.village,
    status: loc.status,
    contractor: loc.contract.contractor.name,
    contractNumber: loc.contract.contractNumber,
    realizedPct: progress.realizedPct,
    planPct: progress.planPct,
    deviationPct: progress.deviationPct,
    weekNumber: progress.weekNumber,
    totalWeeks: progress.totalWeeks,
    phase,
    photos: photoRows.map((p) => ({ id: p.id, url: urls.get(p.r2Key) ?? null })),
  };
}
