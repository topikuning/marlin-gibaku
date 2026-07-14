import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { COUNTED_REPORT_STATUSES, currentWeekNumber } from "@/lib/progress";

/**
 * Layer baseline (kurva-S rencana ber-versi) + deret rencana vs realisasi.
 * Semantik dipertahankan dari b6e77af src/lib/scurve-plan.ts + scurve-data.ts:
 *   - baseline TIDAK pernah di-edit in place — perubahan = baseline BARU,
 *     yang lama di-supersede (histori utuh, DECISIONS 027)
 *   - realisasi = Σ valueDone item laporan counted, bucket per minggu dari
 *     tanggal laporan, kumulatif ÷ grand total revisi aktif
 */

const WEEK_MS = 7 * 24 * 3600 * 1000;

export async function getActiveBaseline(locationId: string) {
  return db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    orderBy: { baselineNo: "desc" },
    include: {
      points: { orderBy: { weekNumber: "asc" }, select: { weekNumber: true, plannedPct: true } },
    },
  });
}

/** Validasi deret plan: 0..100, monotonik naik, akhir 100 ± 0.5. */
export function validateBaselinePoints(points: number[]): string | null {
  if (points.length === 0) return "Deret rencana kosong.";
  let prev = -Infinity;
  for (const [i, p] of points.entries()) {
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      return `Minggu ${i + 1}: nilai ${p} di luar rentang 0–100.`;
    }
    if (p < prev) return `Minggu ${i + 1}: kurva turun (${prev} → ${p}) — harus monotonik naik.`;
    prev = p;
  }
  const last = points[points.length - 1];
  if (Math.abs(last - 100) > 0.5) {
    return `Minggu terakhir harus 100% (±0.5), sekarang ${last}%.`;
  }
  return null;
}

/**
 * Simpan kurva rencana hasil edit manual → baseline BARU source "manual"
 * (baseline lama di-supersede, histori utuh). `baselineId` = baseline acuan
 * yang sedang diedit (sumber locationId/contractDays/rabRevisionId).
 */
export async function updateBaselinePoints(baselineId: string, points: number[], userId: string) {
  const invalid = validateBaselinePoints(points);
  if (invalid) throw new Error(invalid);

  const ref = await db.baseline.findUniqueOrThrow({
    where: { id: baselineId },
    select: { locationId: true, contractDays: true, rabRevisionId: true, baselineNo: true },
  });
  // Jumlah minggu boleh berubah saat edit manual — contractDays ikut deret baru
  // bila tidak lagi cocok dengan acuan.
  const refWeeks = Math.ceil(ref.contractDays / 7);
  const contractDays = refWeeks === points.length ? ref.contractDays : points.length * 7;

  const baseline = await db.$transaction(async (tx) => {
    await tx.baseline.updateMany({
      where: { locationId: ref.locationId, status: "aktif" },
      data: { status: "digantikan", supersededAt: new Date() },
    });
    const last = await tx.baseline.aggregate({
      where: { locationId: ref.locationId },
      _max: { baselineNo: true },
    });
    const created = await tx.baseline.create({
      data: {
        locationId: ref.locationId,
        baselineNo: (last._max.baselineNo ?? 0) + 1,
        source: "manual",
        status: "aktif",
        rabRevisionId: ref.rabRevisionId,
        contractDays,
        note: `Edit manual dari baseline #${ref.baselineNo}`,
        createdById: userId,
      },
    });
    await tx.baselinePoint.createMany({
      data: points.map((p, i) => ({
        baselineId: created.id,
        weekNumber: i + 1,
        plannedPct: p,
      })),
    });
    return created;
  });
  await audit(userId, "baseline.update_points", "baseline", baseline.id, {
    locationId: ref.locationId,
    fromBaselineId: baselineId,
    baselineNo: baseline.baselineNo,
    weeks: points.length,
  });
  return baseline;
}

export type ScurveSeries = {
  totalWeeks: number;
  /** Minggu berjalan (clamp 1..totalWeeks). */
  currentWeek: number;
  /** Plan kumulatif % per minggu (index 0 = minggu 1). */
  planPct: number[];
  /** Realisasi kumulatif % per minggu; null untuk minggu > minggu berjalan. */
  actualPct: (number | null)[];
  grandTotal: bigint;
};

/**
 * Deret kurva-S lokasi: plan dari baseline aktif, realisasi dari
 * DailyReportItem.valueDone (laporan counted), bucket minggu
 * = floor((reportDate − startDate) / 7 hari) + 1, kumulatif ÷ grand total
 * revisi aktif × 100. Lineage dicocokkan ke item revisi AKTIF supaya angka
 * konsisten dengan lib/progress (carry-over lintas revisi by lineageKey).
 */
export async function getScurveSeries(locationId: string): Promise<ScurveSeries> {
  const [baseline, revision, loc] = await Promise.all([
    getActiveBaseline(locationId),
    db.rabRevision.findFirst({
      where: { locationId, status: "aktif" },
      select: { id: true },
    }),
    db.location.findUnique({
      where: { id: locationId },
      select: { package: { select: { contract: { select: { startDate: true } } } } },
    }),
  ]);

  if (!baseline || baseline.points.length === 0) {
    return { totalWeeks: 0, currentWeek: 1, planPct: [], actualPct: [], grandTotal: 0n };
  }

  const planPct = baseline.points.map((p) => Number(p.plannedPct));
  const totalWeeks = planPct.length;
  // startDate kontrak = minggu-1; fallback tanggal baseline dibuat (lokasi tanpa kontrak).
  const startDate = loc?.package.contract?.startDate ?? baseline.createdAt;
  const currentWeek = currentWeekNumber(startDate, totalWeeks);

  let grandTotal = 0n;
  const perWeek: bigint[] = new Array<bigint>(totalWeeks).fill(0n);
  if (revision) {
    const catAgg = await db.rabNode.aggregate({
      where: { revisionId: revision.id, kind: "kategori" },
      _sum: { amount: true },
    });
    grandTotal = catAgg._sum.amount ?? 0n;

    const rows = await db.dailyReportItem.findMany({
      where: {
        report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } },
        lineageKey: { in: (
          await db.rabNode.findMany({
            where: { revisionId: revision.id, kind: "item" },
            select: { lineageKey: true },
          })
        ).map((n) => n.lineageKey) },
      },
      select: { valueDone: true, report: { select: { reportDate: true } } },
    });
    for (const r of rows) {
      const wk = Math.floor((r.report.reportDate.getTime() - startDate.getTime()) / WEEK_MS) + 1;
      const idx = Math.max(1, Math.min(wk, totalWeeks)) - 1;
      perWeek[idx] += r.valueDone;
    }
  }

  let cum = 0n;
  const actualPct: (number | null)[] = [];
  for (let w = 1; w <= totalWeeks; w++) {
    cum += perWeek[w - 1];
    actualPct.push(
      w <= currentWeek ? (grandTotal > 0n ? (Number(cum) / Number(grandTotal)) * 100 : 0) : null,
    );
  }

  return { totalWeeks, currentWeek, planPct, actualPct, grandTotal };
}
