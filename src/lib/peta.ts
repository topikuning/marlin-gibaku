import "server-only";
import { db } from "@/lib/db";
import { getLocationProgress } from "@/lib/progress";
import { bigintToString } from "@/lib/money";
import type { DailyReportStatus, LocationStatus } from "@/generated/prisma/enums";

/**
 * Data layer halaman Peta (port dari versi lama, adaptasi schema rebuild):
 * marker = lokasi ber-GPS (scoped penugasan); snapshot = ringkasan satu lokasi
 * saat titik diklik (identitas + kontrak + progress + laporan terakhir).
 */

export type PetaMarker = {
  id: string;
  slug: string;
  name: string;
  village: string;
  regency: string;
  province: string;
  lat: number;
  lng: number;
  status: LocationStatus;
  packageName: string;
};

/** Titik lokasi untuk peta — hanya yang punya koordinat. scopedIds null = semua. */
export async function getPetaMarkers(scopedIds: string[] | null): Promise<PetaMarker[]> {
  const locations = await db.location.findMany({
    where: {
      ...(scopedIds === null ? {} : { id: { in: scopedIds } }),
      gpsLat: { not: null },
      gpsLng: { not: null },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      village: true,
      regency: true,
      province: true,
      status: true,
      gpsLat: true,
      gpsLng: true,
      package: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  const out: PetaMarker[] = [];
  for (const l of locations) {
    const lat = Number(l.gpsLat);
    const lng = Number(l.gpsLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: l.id,
      slug: l.slug,
      name: l.name,
      village: l.village,
      regency: l.regency,
      province: l.province,
      lat,
      lng,
      status: l.status,
      packageName: l.package.name,
    });
  }
  return out;
}

export type LocationSnapshot = {
  id: string;
  slug: string;
  name: string;
  village: string;
  regency: string;
  province: string;
  status: LocationStatus;
  packageName: string;
  vendorName: string | null;
  contractNumber: string | null;
  /** Rupiah, BigInt diserialisasi ke string (aman JSON). */
  contractValue: string | null;
  /** ISO datetime string (kolom @db.Date). */
  startDate: string | null;
  endDate: string | null;
  planPct: number;
  realizedPct: number;
  deviationPct: number;
  weekNumber: number;
  totalWeeks: number;
  lastReport: { date: string; status: DailyReportStatus } | null;
};

/** Ringkasan 1 lokasi untuk panel detail peta. null bila lokasi tidak ada. */
export async function getLocationSnapshot(locationId: string): Promise<LocationSnapshot | null> {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      slug: true,
      name: true,
      village: true,
      regency: true,
      province: true,
      status: true,
      package: {
        select: {
          name: true,
          contract: {
            select: {
              contractNumber: true,
              contractValue: true,
              startDate: true,
              endDate: true,
              vendor: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!loc) return null;

  const [progress, lastReport] = await Promise.all([
    getLocationProgress(locationId),
    db.dailyReport.findFirst({
      where: { locationId },
      orderBy: { reportDate: "desc" },
      select: { reportDate: true, status: true },
    }),
  ]);

  const contract = loc.package.contract;
  const raw = {
    id: loc.id,
    slug: loc.slug,
    name: loc.name,
    village: loc.village,
    regency: loc.regency,
    province: loc.province,
    status: loc.status,
    packageName: loc.package.name,
    vendorName: contract?.vendor.name ?? null,
    contractNumber: contract?.contractNumber ?? null,
    contractValue: contract?.contractValue ?? null,
    startDate: contract?.startDate ?? null,
    endDate: contract?.endDate ?? null,
    planPct: progress.planPct,
    realizedPct: progress.realizedPct,
    deviationPct: progress.deviationPct,
    weekNumber: progress.weekNumber,
    totalWeeks: progress.totalWeeks,
    lastReport: lastReport ? { date: lastReport.reportDate, status: lastReport.status } : null,
  };
  // bigintToString me-round-trip JSON: BigInt → string, Date → ISO string.
  return bigintToString(raw) as unknown as LocationSnapshot;
}
