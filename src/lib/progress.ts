import { db } from "@/lib/db";
import { getActiveLineages } from "@/lib/rab";
import { getPlannedSeries } from "@/lib/scurve-plan";

export type LocationProgress = {
  grandTotal: bigint;
  realizedValue: bigint;
  realizedPct: number;
  planPct: number;
  deviationPct: number;
  weekNumber: number;
  totalWeeks: number;
};

function pct(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return (Number(part) / Number(whole)) * 100;
}

/**
 * Progress satu lokasi: realisasi (SUM value_done item 'sent') vs rencana
 * (target kurva-S minggu berjalan). grandTotal = SUM kategori aktif (DECISIONS 014).
 */
export async function getLocationProgress(
  locationId: string,
  startDate: Date
): Promise<LocationProgress> {
  const [catAgg, planned, lineages] = await Promise.all([
    // grandTotal = SUM kategori aktif (DECISIONS 014), bukan revision.totalValue
    // yang bisa basi/0 — konsisten dengan halaman detail & ringkasan RAB.
    db.rabCategory.aggregate({
      where: { locationId, revision: { status: "active" } },
      _sum: { totalValue: true },
    }),
    getPlannedSeries(locationId), // rencana dari plan kurva-S aktif (DECISIONS 027)
    getActiveLineages(locationId),
  ]);

  const grandTotal = catAgg._sum.totalValue ?? 0n;

  // Realisasi by lineage → laporan yang di-approve tetap terhitung meski
  // item-nya sudah pindah revisi (carry-over adendum). DECISIONS 023.
  const valAgg =
    lineages.length > 0
      ? await db.dailyReportItem.aggregate({
          where: { state: "sent", rabItem: { lineageId: { in: lineages } } },
          _sum: { valueDone: true },
        })
      : { _sum: { valueDone: 0n } };
  const realizedValue = valAgg._sum.valueDone ?? 0n;

  const plan = planned.plannedPct;
  const totalWeeks = plan.length;
  const msSinceStart = Date.now() - startDate.getTime();
  const weeksElapsed = Math.floor(msSinceStart / (7 * 24 * 3600 * 1000)) + 1;
  const weekNumber = Math.min(Math.max(weeksElapsed, 1), Math.max(totalWeeks, 1));
  const planPct =
    totalWeeks === 0 ? 0 : (plan[weekNumber - 1] ?? plan[totalWeeks - 1]);

  const realizedPct = pct(realizedValue, grandTotal);

  return {
    grandTotal,
    realizedValue,
    realizedPct,
    planPct,
    deviationPct: realizedPct - planPct,
    weekNumber,
    totalWeeks,
  };
}
