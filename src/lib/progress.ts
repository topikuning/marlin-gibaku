import { db } from "@/lib/db";
import { getActiveLineages } from "@/lib/rab";

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
  const [activeRev, milestones, lineages] = await Promise.all([
    db.rabRevision.findFirst({
      where: { locationId, status: "active" },
      orderBy: { revisionNo: "desc" },
      select: { totalValue: true },
    }),
    db.scheduledMilestone.findMany({
      where: { locationId, rabItemId: null },
      orderBy: { weekNumber: "asc" },
      select: { weekNumber: true, targetProgressPct: true },
    }),
    getActiveLineages(locationId),
  ]);

  const grandTotal = activeRev?.totalValue ?? 0n;

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

  const totalWeeks = milestones.length;
  const msSinceStart = Date.now() - startDate.getTime();
  const weeksElapsed = Math.floor(msSinceStart / (7 * 24 * 3600 * 1000)) + 1;
  const weekNumber = Math.min(Math.max(weeksElapsed, 1), Math.max(totalWeeks, 1));
  const planPct =
    totalWeeks === 0
      ? 0
      : (milestones[weekNumber - 1]?.targetProgressPct.toNumber() ??
        milestones[totalWeeks - 1].targetProgressPct.toNumber());

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
