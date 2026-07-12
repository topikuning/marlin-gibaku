import { db } from "@/lib/db";
import { getActiveLineages } from "@/lib/rab";
import { getPlannedSeries } from "@/lib/scurve-plan";

export type ScurveSeries = {
  weeks: number[]; // 1..N
  plannedPct: number[]; // target kumulatif % per minggu (bentuk kurva-S)
  actualPct: (number | null)[]; // realisasi kumulatif %; null utk minggu depan
  currentWeek: number;
  totalWeeks: number;
  grandTotal: bigint;
};

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * Deret kurva-S satu lokasi: rencana (milestone mingguan) vs realisasi
 * (SUM value_done item 'sent', di-bucket per minggu dari tanggal disetujui).
 */
export async function getScurveSeries(
  locationId: string,
  startDate: Date
): Promise<ScurveSeries> {
  const [planned, catAgg, lineages] = await Promise.all([
    getPlannedSeries(locationId), // rencana dari plan kurva-S aktif (DECISIONS 027)
    db.rabCategory.aggregate({
      where: { locationId, revision: { status: "active" } },
      _sum: { totalValue: true },
    }),
    getActiveLineages(locationId),
  ]);

  const grandTotal = catAgg._sum.totalValue ?? 0n;
  const totalWeeks = planned.plannedPct.length;
  const weeks = planned.weeks;
  const plannedPct = planned.plannedPct;

  const currentWeek = Math.min(
    Math.max(Math.floor((Date.now() - startDate.getTime()) / WEEK_MS) + 1, 1),
    Math.max(totalWeeks, 1)
  );

  const sent =
    lineages.length > 0
      ? await db.dailyReportItem.findMany({
          where: { state: "sent", rabItem: { lineageId: { in: lineages } } },
          select: {
            valueDone: true,
            approvedAt: true,
            suggestedAt: true,
            createdAt: true,
          },
        })
      : [];

  const perWeek: bigint[] = new Array(totalWeeks).fill(0n);
  for (const it of sent) {
    const d = it.approvedAt ?? it.suggestedAt ?? it.createdAt;
    let wk = Math.floor((d.getTime() - startDate.getTime()) / WEEK_MS) + 1;
    wk = Math.min(Math.max(wk, 1), Math.max(totalWeeks, 1));
    perWeek[wk - 1] += it.valueDone;
  }

  let cum = 0n;
  const actualPct: (number | null)[] = [];
  for (let w = 0; w < totalWeeks; w++) {
    cum += perWeek[w];
    actualPct.push(
      w + 1 <= currentWeek
        ? grandTotal > 0n
          ? (Number(cum) / Number(grandTotal)) * 100
          : 0
        : null
    );
  }

  return { weeks, plannedPct, actualPct, currentWeek, totalWeeks, grandTotal };
}
