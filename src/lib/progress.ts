import "server-only";
import { db } from "@/lib/db";
import { pct } from "@/lib/money";

/**
 * Calculation layer progress — SATU sumber untuk dashboard, workspace, laporan, export.
 * Formula dipertahankan dari implementasi lama yang terverifikasi (docs/rebuild/DATA_MODEL_AUDIT.md):
 *   grandTotal   = Σ amount node kind "kategori" pada revisi aktif
 *   realized     = Σ valueDone item laporan status ≥ dikirim (dikirim/disetujui/final), by lineageKey revisi aktif
 *   deviationPct = realizedPct − planPct
 */

export const COUNTED_REPORT_STATUSES = ["dikirim", "disetujui", "final"] as const;

const WEEK_MS = 7 * 24 * 3600 * 1000;

export type LocationProgress = {
  locationId: string;
  grandTotal: bigint;
  realizedValue: bigint;
  realizedPct: number;
  planPct: number;
  deviationPct: number;
  weekNumber: number;
  totalWeeks: number;
  activeRevisionId: string | null;
  activeBaselineId: string | null;
};

/** Nomor minggu berjalan sejak startDate, clamp [1, totalWeeks]. */
export function currentWeekNumber(startDate: Date, totalWeeks: number, now = new Date()): number {
  const wk = Math.floor((now.getTime() - startDate.getTime()) / WEEK_MS) + 1;
  return Math.max(1, Math.min(wk, Math.max(totalWeeks, 1)));
}

/** Plan % kumulatif pada minggu tertentu dari deret baseline (clamp minggu terakhir). */
export function planPctAtWeek(points: number[], weekNumber: number): number {
  if (points.length === 0) return 0;
  const idx = Math.max(0, Math.min(weekNumber - 1, points.length - 1));
  return points[idx];
}

/** Progress banyak lokasi sekaligus (batched, bukan per-lokasi N+1). */
export async function getLocationsProgress(locationIds: string[]): Promise<Map<string, LocationProgress>> {
  const result = new Map<string, LocationProgress>();
  if (locationIds.length === 0) return result;

  const [revisions, baselines, contracts] = await Promise.all([
    db.rabRevision.findMany({
      where: { locationId: { in: locationIds }, status: "aktif" },
      select: { id: true, locationId: true },
    }),
    db.baseline.findMany({
      where: { locationId: { in: locationIds }, status: "aktif" },
      select: { id: true, locationId: true, contractDays: true, points: { select: { weekNumber: true, plannedPct: true }, orderBy: { weekNumber: "asc" } } },
    }),
    db.contract.findMany({
      where: { package: { locations: { some: { id: { in: locationIds } } } } },
      select: { startDate: true, package: { select: { locations: { select: { id: true } } } } },
    }),
  ]);

  const revByLoc = new Map(revisions.map((r) => [r.locationId, r.id]));
  const baseByLoc = new Map(baselines.map((b) => [b.locationId, b]));
  const startByLoc = new Map<string, Date | null>();
  for (const c of contracts) {
    for (const l of c.package.locations) startByLoc.set(l.id, c.startDate);
  }

  const revIds = revisions.map((r) => r.id);
  // grandTotal per revisi aktif = Σ amount kategori
  const catSums = revIds.length
    ? await db.rabNode.groupBy({
        by: ["revisionId"],
        where: { revisionId: { in: revIds }, kind: "kategori" },
        _sum: { amount: true },
      })
    : [];
  const totalByRev = new Map(catSums.map((c) => [c.revisionId, c._sum.amount ?? 0n]));

  // realized per lokasi: Σ valueDone item laporan counted, hanya lineage yang ada di revisi aktif
  const realizedPerLoc = await db.$queryRaw<{ location_id: string; realized: bigint }[]>`
    SELECT dr.location_id, COALESCE(SUM(dri.value_done), 0)::bigint AS realized
    FROM daily_report_items dri
    JOIN daily_reports dr ON dr.id = dri.report_id
    JOIN rab_nodes rn ON rn.lineage_key = dri.lineage_key
    JOIN rab_revisions rr ON rr.id = rn.revision_id
      AND rr.location_id = dr.location_id AND rr.status = 'aktif'
    WHERE dr.location_id = ANY(${locationIds}::uuid[])
      AND dr.status IN ('dikirim','disetujui','final')
      AND rn.kind = 'item'
    GROUP BY dr.location_id
  `;
  const realizedByLoc = new Map(realizedPerLoc.map((r) => [r.location_id, BigInt(r.realized)]));

  for (const locId of locationIds) {
    const revId = revByLoc.get(locId) ?? null;
    const baseline = baseByLoc.get(locId);
    const grandTotal = revId ? (totalByRev.get(revId) ?? 0n) : 0n;
    const realizedValue = realizedByLoc.get(locId) ?? 0n;
    const points = baseline?.points.map((p) => Number(p.plannedPct)) ?? [];
    const totalWeeks = points.length || Math.ceil((baseline?.contractDays ?? 0) / 7);
    const start = startByLoc.get(locId);
    const weekNumber = start ? currentWeekNumber(start, totalWeeks) : 1;
    const planPct = planPctAtWeek(points, weekNumber);
    const realizedPct = pct(realizedValue, grandTotal);
    result.set(locId, {
      locationId: locId,
      grandTotal,
      realizedValue,
      realizedPct,
      planPct,
      deviationPct: realizedPct - planPct,
      weekNumber,
      totalWeeks,
      activeRevisionId: revId,
      activeBaselineId: baseline?.id ?? null,
    });
  }
  return result;
}

export async function getLocationProgress(locationId: string): Promise<LocationProgress> {
  const map = await getLocationsProgress([locationId]);
  return (
    map.get(locationId) ?? {
      locationId,
      grandTotal: 0n,
      realizedValue: 0n,
      realizedPct: 0,
      planPct: 0,
      deviationPct: 0,
      weekNumber: 1,
      totalWeeks: 0,
      activeRevisionId: null,
      activeBaselineId: null,
    }
  );
}

/**
 * Kumulatif volume per lineageKey utk satu lokasi (laporan status counted).
 *
 * Tanpa `upToDate` → kumulatif TOTAL lintas semua tanggal: dipakai guard anti-lebih
 * (total realisasi tak boleh > volume RAB) dan sisa volume di form input.
 *
 * Dengan `upToDate` → kumulatif "s/d tanggal itu" (reportDate ≤ upToDate): dipakai
 * tampilan/cetak KKP per hari, supaya laporan tanggal lama TIDAK ikut menghitung
 * realisasi hari sesudahnya (mis. laporan 12 Juli tak boleh terhitung volume 13 Juli).
 */
export async function cumulativeVolumeByLineage(
  locationId: string,
  upToDate?: Date,
): Promise<Map<string, number>> {
  const rows = await db.dailyReportItem.groupBy({
    by: ["lineageKey"],
    where: {
      report: {
        locationId,
        status: { in: [...COUNTED_REPORT_STATUSES] },
        ...(upToDate ? { reportDate: { lte: upToDate } } : {}),
      },
    },
    _sum: { volumeDone: true },
  });
  return new Map(rows.map((r) => [r.lineageKey, Number(r._sum.volumeDone ?? 0)]));
}
