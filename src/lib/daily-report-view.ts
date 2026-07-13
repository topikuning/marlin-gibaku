import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";
import { hasLocationAccess } from "@/lib/access";
import { getReportableItems } from "@/lib/rab";
import { parseLogDate } from "@/lib/daily-log";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";
import type { UserRole, WeatherCode, WorkerRole } from "@prisma/client";

const jkDate = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" });
const jkHari = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "Asia/Jakarta" });
const jkDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });

const WEATHER_CAT: Partial<Record<WeatherCode, "Cerah" | "Mendung" | "Hujan">> = {
  cerah: "Cerah",
  berawan: "Mendung",
  hujan_ringan: "Hujan",
  hujan_deras: "Hujan",
  angin_kencang: "Hujan",
  banjir: "Hujan",
};

export type DailyReportView = {
  locationName: string;
  data: KkpDailyData;
  editor: {
    weather: WeatherCode | null;
    workStart: string | null;
    workEnd: string | null;
    notes: string | null;
    workers: Partial<Record<WorkerRole, number>>;
    materials: { name: string; unit: string; qty: string }[];
    equipment: { name: string; count: string }[];
  };
};

/** Ambil + hitung data laporan harian KKP (dipakai halaman preview & cetak). */
export async function getDailyReportView(
  slug: string,
  date: string,
  userId: string,
  role: UserRole
): Promise<DailyReportView | "notfound" | "forbidden"> {
  const logDate = parseLogDate(date);
  if (!logDate) return "notfound";

  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      regency: true,
      province: true,
      contract: { select: { startDate: true } },
    },
  });
  if (!location) return "notfound";
  if (!isCrossLocation(role) && !(await hasLocationAccess(userId, role, location.id)))
    return "forbidden";

  const [log, reportable] = await Promise.all([
    db.dailyLog.findUnique({
      where: { locationId_logDate: { locationId: location.id, logDate } },
      include: { workers: true, materials: true, equipment: { orderBy: { name: "asc" } } },
    }),
    getReportableItems(location.id),
  ]);

  const rabIds = reportable.map((r) => r.id);
  const itemMeta = new Map(reportable.map((r) => [r.id, r]));
  const dayRows = rabIds.length
    ? (
        await db.dailyReportItem.findMany({
          where: { rabItemId: { in: rabIds }, state: { in: ["approved", "sent"] } },
          select: { rabItemId: true, volumeDone: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      ).filter((it) => jkDay.format(it.createdAt) === date)
    : [];

  const workerMap: Record<string, number> = {};
  for (const w of log?.workers ?? []) workerMap[w.role] = w.count;
  const totalWorkers = (log?.workers ?? []).reduce((n, w) => n + w.count, 0);
  const startDate = location.contract?.startDate ?? null;

  const data: KkpDailyData = {
    locationName: location.name,
    regency: location.regency,
    province: location.province,
    hari: jkHari.format(logDate),
    tanggalFull: jkDate.format(logDate),
    weekNo: startDate
      ? Math.max(1, Math.floor((logDate.getTime() - startDate.getTime()) / (7 * 86_400_000)) + 1)
      : null,
    tahunAnggaran: startDate?.getFullYear() ?? logDate.getUTCFullYear(),
    workerMap,
    totalWorkers,
    activeWeather: log?.weather ? WEATHER_CAT[log.weather] ?? null : null,
    workStart: log?.workStart ?? null,
    workEnd: log?.workEnd ?? null,
    notes: log?.notes ?? null,
    materials: (log?.materials ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      qty: m.qtyReceived != null ? m.qtyReceived.toNumber() : null,
    })),
    equipment: (log?.equipment ?? []).map((e) => ({ id: e.id, name: e.name, count: e.count })),
    dayItems: dayRows.map((it) => {
      const meta = itemMeta.get(it.rabItemId);
      return { name: meta?.name ?? it.rabItemId, unit: meta?.unit ?? "", volume: it.volumeDone.toNumber() };
    }),
  };

  return {
    locationName: location.name,
    data,
    editor: {
      weather: log?.weather ?? null,
      workStart: log?.workStart ?? null,
      workEnd: log?.workEnd ?? null,
      notes: log?.notes ?? null,
      workers: workerMap as Partial<Record<WorkerRole, number>>,
      materials: (log?.materials ?? []).map((m) => ({
        name: m.name,
        unit: m.unit ?? "",
        qty: m.qtyReceived != null ? String(m.qtyReceived.toNumber()) : "",
      })),
      equipment: (log?.equipment ?? []).map((e) => ({ name: e.name, count: String(e.count) })),
    },
  };
}
