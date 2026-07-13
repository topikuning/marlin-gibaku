import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";
import { hasLocationAccess } from "@/lib/access";
import { getReportableItems } from "@/lib/rab";
import { getScurveSeries } from "@/lib/scurve-data";
import type { UserRole } from "@prisma/client";

const jkDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });

export type PeriodKind = "mingguan" | "bulanan";

export type PeriodReport = {
  kind: PeriodKind;
  n: number;
  totalWeeks: number;
  totalMonths: number;
  locationName: string;
  regency: string;
  province: string;
  contractNumber: string;
  tahunAnggaran: number;
  periodeStart: Date;
  periodeEnd: Date;
  planPct: number;
  actualPct: number;
  deviationPct: number;
  items: { name: string; unit: string; volume: number }[];
  deviations: { cause: string; recovery: string | null; at: Date }[];
};

function addMonths(base: Date, months: number): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()));
}

export async function getPeriodReport(
  slug: string,
  kind: PeriodKind,
  n: number,
  userId: string,
  role: UserRole
): Promise<PeriodReport | "notfound" | "forbidden"> {
  if (!Number.isInteger(n) || n < 1) return "notfound";

  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      regency: true,
      province: true,
      contract: { select: { contractNumber: true, startDate: true, endDate: true } },
    },
  });
  if (!location) return "notfound";
  if (!isCrossLocation(role) && !(await hasLocationAccess(userId, role, location.id)))
    return "forbidden";

  const start = location.contract.startDate;
  const scurve = await getScurveSeries(location.id, start);
  const totalWeeks = scurve.totalWeeks;
  const totalMonths = Math.max(1, Math.ceil(totalWeeks / 4.345));

  let periodeStart: Date;
  let periodeEnd: Date;
  let weekIndex: number; // 1-based week whose cumulative we report
  if (kind === "mingguan") {
    periodeStart = new Date(start.getTime() + (n - 1) * 7 * 86_400_000);
    periodeEnd = new Date(periodeStart.getTime() + 6 * 86_400_000);
    weekIndex = n;
  } else {
    periodeStart = addMonths(start, n - 1);
    periodeEnd = new Date(addMonths(start, n).getTime() - 86_400_000);
    weekIndex = Math.min(totalWeeks, Math.max(1, Math.floor((periodeEnd.getTime() - start.getTime()) / (7 * 86_400_000)) + 1));
  }

  const idx = Math.min(scurve.plannedPct.length, Math.max(1, weekIndex)) - 1;
  const planPct = scurve.plannedPct[idx] ?? 0;
  const actualPct = scurve.actualPct[idx] ?? 0;

  // Realisasi item dalam periode (Asia/Jakarta).
  const reportable = await getReportableItems(location.id);
  const meta = new Map(reportable.map((r) => [r.id, r]));
  const rabIds = reportable.map((r) => r.id);
  const sStr = jkDay.format(periodeStart);
  const eStr = jkDay.format(periodeEnd);
  const rows = rabIds.length
    ? (
        await db.dailyReportItem.findMany({
          where: { rabItemId: { in: rabIds }, state: { in: ["approved", "sent"] } },
          select: { rabItemId: true, volumeDone: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      ).filter((it) => {
        const d = jkDay.format(it.createdAt);
        return d >= sStr && d <= eStr;
      })
    : [];
  // Agregasi volume per item.
  const agg = new Map<string, number>();
  for (const r of rows) agg.set(r.rabItemId, (agg.get(r.rabItemId) ?? 0) + r.volumeDone.toNumber());
  const items = [...agg.entries()].map(([id, volume]) => {
    const m = meta.get(id);
    return { name: m?.name ?? id, unit: m?.unit ?? "", volume };
  });

  const deviationRows = await db.deviationNote.findMany({
    where: { locationId: location.id, createdAt: { gte: periodeStart, lte: new Date(periodeEnd.getTime() + 86_400_000) } },
    orderBy: { createdAt: "desc" },
  });

  return {
    kind,
    n,
    totalWeeks,
    totalMonths,
    locationName: location.name,
    regency: location.regency,
    province: location.province,
    contractNumber: location.contract.contractNumber,
    tahunAnggaran: start.getFullYear(),
    periodeStart,
    periodeEnd,
    planPct,
    actualPct,
    deviationPct: actualPct - planPct,
    items,
    deviations: deviationRows.map((d) => ({ cause: d.cause, recovery: d.recovery, at: d.createdAt })),
  };
}
