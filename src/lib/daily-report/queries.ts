import "server-only";
import { db } from "@/lib/db";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { buildPhotoViews, type PhotoView } from "@/lib/photos";
import type { DailyReportStatus, IssueSeverity, IssueStatus, WeatherCode, WorkerRole } from "@/generated/prisma/enums";
import { WEATHER_KKP_CATEGORY } from "./constants";
import type { FinalSnapshot } from "./service";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";

/** Query layer laporan harian — semua read untuk /hari-ini, workspace, dan cetak. */

// ─────────────────────────────────────────────────────────────
// Pilihan item RAB (leaf revisi aktif) untuk form input
// ─────────────────────────────────────────────────────────────

export type LeafNodeOption = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
  lineageKey: string;
  /** Nama kategori teratas — konteks pencarian. */
  category: string;
  /** Sisa volume yang masih bisa dilaporkan (volume − kumulatif counted). */
  remaining: number | null;
};

/** Leaf item RAB revisi aktif + sisa volume, serialized untuk client search. */
export async function getLeafNodeOptions(locationId: string): Promise<LeafNodeOption[]> {
  const revision = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  if (!revision) return [];

  const [nodes, cumulative] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: revision.id },
      select: {
        id: true,
        parentId: true,
        kind: true,
        code: true,
        name: true,
        unit: true,
        volume: true,
        lineageKey: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
    cumulativeVolumeByLineage(locationId),
  ]);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const categoryOf = (nodeId: string): string => {
    let cur = byId.get(nodeId);
    let label = "";
    while (cur) {
      if (cur.kind === "kategori") {
        label = cur.name;
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return label;
  };

  return nodes
    .filter((n) => n.kind === "item")
    .map((n) => {
      const volume = n.volume != null ? Number(n.volume) : null;
      const done = cumulative.get(n.lineageKey) ?? 0;
      return {
        id: n.id,
        code: n.code,
        name: n.name,
        unit: n.unit,
        volume,
        lineageKey: n.lineageKey,
        category: categoryOf(n.id),
        remaining: volume != null ? Math.max(0, Math.round((volume - done) * 1000) / 1000) : null,
      };
    });
}

// ─────────────────────────────────────────────────────────────
// Workspace harian (satu layar)
// ─────────────────────────────────────────────────────────────

export type WorkspaceItem = {
  id: string;
  rabNodeId: string;
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  volumeDone: number;
  valueDone: string; // BigInt string
  volumeContract: number | null;
  volumeCumulative: number;
  pctCumulative: number | null;
  notes: string | null;
  photos: PhotoView[];
};

export type WorkspaceHistoryRow = {
  id: string;
  fromStatus: DailyReportStatus | null;
  toStatus: DailyReportStatus;
  changedAt: string; // ISO
  changedByName: string;
  reason: string | null;
};

export type WorkspaceIssue = {
  id: string;
  title: string;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
};

export type WorkspaceReport = {
  id: string;
  status: DailyReportStatus;
  weather: WeatherCode | null;
  workStart: string | null;
  workEnd: string | null;
  notes: string | null;
  items: WorkspaceItem[];
  totalValueToday: string; // BigInt string
  workers: { role: WorkerRole; count: number }[];
  materials: { id: string; name: string; unit: string | null; qty: number | null }[];
  equipment: { id: string; name: string; count: number }[];
  history: WorkspaceHistoryRow[];
  issues: WorkspaceIssue[];
  photos: PhotoView[];
  /** Alasan pengembalian terakhir (transisi → perlu_koreksi paling baru). */
  lastCorrectionReason: string | null;
  isFinal: boolean;
};

export type RecentDay = {
  dateKey: string;
  status: DailyReportStatus | null;
  itemCount: number;
};

export type WorkspaceData = {
  location: { id: string; slug: string; name: string; village: string; regency: string; province: string };
  dateKey: string;
  report: WorkspaceReport | null;
  recentDays: RecentDay[];
};

/** Daftar N hari terakhir (termasuk dateKey acuan) + status laporan per hari. */
export async function getRecentDays(locationId: string, days: number, endKey?: string): Promise<RecentDay[]> {
  const end = parseDateKey(endKey ?? jakartaDateKey(new Date()))!;
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const reports = await db.dailyReport.findMany({
    where: { locationId, reportDate: { gte: start, lte: end } },
    select: { reportDate: true, status: true, _count: { select: { items: true } } },
  });
  const byKey = new Map(reports.map((r) => [jakartaDateKey(r.reportDate), r]));
  const out: RecentDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(end.getTime() - i * 86_400_000);
    const key = jakartaDateKey(d);
    const r = byKey.get(key);
    out.push({ dateKey: key, status: r?.status ?? null, itemCount: r?._count.items ?? 0 });
  }
  return out;
}

/** Muat seluruh data workspace harian satu lokasi + tanggal. null bila lokasi tak ada. */
export async function getWorkspaceData(slug: string, dateKey: string): Promise<WorkspaceData | null> {
  const reportDate = parseDateKey(dateKey);
  if (!reportDate) return null;
  const location = await db.location.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, village: true, regency: true, province: true },
  });
  if (!location) return null;

  const [report, recentDays] = await Promise.all([
    db.dailyReport.findUnique({
      where: { locationId_reportDate: { locationId: location.id, reportDate } },
      include: {
        items: { include: { rabNode: true }, orderBy: { createdAt: "asc" } },
        workers: true,
        materials: { orderBy: { name: "asc" } },
        equipment: { orderBy: { name: "asc" } },
        statusHistory: { orderBy: { changedAt: "asc" } },
        photos: { orderBy: { createdAt: "asc" } },
        issues: { orderBy: { createdAt: "asc" } },
      },
    }),
    getRecentDays(location.id, 14, dateKey),
  ]);

  if (!report) return { location, dateKey, report: null, recentDays };

  // Kumulatif "s/d tanggal laporan ini" — laporan tanggal sesudahnya TIDAK ikut
  // dihitung, supaya angka kumulatif hari ini tidak tampak menghitung volume
  // dari laporan hari berikutnya (mis. 12 Juli tak boleh menyerap 13 Juli).
  const [cumulative, photoViews] = await Promise.all([
    cumulativeVolumeByLineage(location.id, reportDate),
    buildPhotoViews(report.photos),
  ]);
  const photoByItem = new Map<string, PhotoView[]>();
  for (const p of photoViews) {
    if (!p.reportItemId) continue;
    const arr = photoByItem.get(p.reportItemId) ?? [];
    arr.push(p);
    photoByItem.set(p.reportItemId, arr);
  }

  // Nama pengubah status (DailyReportStatusHistory tidak punya relasi user).
  const userIds = [...new Set(report.statusHistory.map((h) => h.changedById))];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));

  // Kumulatif counted: laporan status editable (draft/perlu_koreksi) belum
  // counted — tampilkan kumulatif TERMASUK angka hari ini supaya SM lihat efeknya.
  const counted = new Set<DailyReportStatus>(["dikirim", "disetujui", "final"]);
  const includesSelf = counted.has(report.status);

  let totalValueToday = 0n;
  const items: WorkspaceItem[] = report.items.map((it) => {
    const volumeDone = Number(it.volumeDone);
    const base = cumulative.get(it.lineageKey) ?? 0;
    const volumeCumulative = Math.round((includesSelf ? base : base + volumeDone) * 1000) / 1000;
    const volumeContract = it.rabNode.volume != null ? Number(it.rabNode.volume) : null;
    totalValueToday += it.valueDone;
    return {
      id: it.id,
      rabNodeId: it.rabNodeId,
      lineageKey: it.lineageKey,
      code: it.rabNode.code,
      name: it.rabNode.name,
      unit: it.rabNode.unit,
      volumeDone,
      valueDone: it.valueDone.toString(),
      volumeContract,
      volumeCumulative,
      pctCumulative:
        volumeContract != null && volumeContract > 0 ? (volumeCumulative / volumeContract) * 100 : null,
      notes: it.notes,
      photos: photoByItem.get(it.id) ?? [],
    };
  });

  const lastCorrection = [...report.statusHistory]
    .reverse()
    .find((h) => h.toStatus === "perlu_koreksi");

  return {
    location,
    dateKey,
    recentDays,
    report: {
      id: report.id,
      status: report.status,
      weather: report.weather,
      workStart: report.workStart,
      workEnd: report.workEnd,
      notes: report.notes,
      items,
      totalValueToday: totalValueToday.toString(),
      workers: report.workers.map((w) => ({ role: w.role, count: w.count })),
      materials: report.materials.map((m) => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        qty: m.qtyReceived != null ? Number(m.qtyReceived) : null,
      })),
      equipment: report.equipment.map((e) => ({ id: e.id, name: e.name, count: e.count })),
      history: report.statusHistory.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedAt: h.changedAt.toISOString(),
        changedByName: nameById.get(h.changedById) ?? "—",
        reason: h.reason,
      })),
      issues: report.issues.map((i) => ({
        id: i.id,
        title: i.title,
        description: i.description,
        severity: i.severity,
        status: i.status,
      })),
      photos: photoViews,
      lastCorrectionReason: lastCorrection?.reason ?? null,
      isFinal: report.status === "final",
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Landing lapangan /hari-ini
// ─────────────────────────────────────────────────────────────

export type WeeklyTarget = {
  name: string;
  unit: string | null;
  targetVolume: number;
  realizedVolume: number;
  priority: number;
};

export type PendingCorrection = {
  dateKey: string;
  itemCount: number;
  reason: string | null;
};

export type HariIniLocation = {
  id: string;
  slug: string;
  name: string;
  village: string;
  regency: string;
  todayDraftItemCount: number | null; // null = belum ada laporan hari ini
  todayStatus: DailyReportStatus | null;
  corrections: PendingCorrection[];
  weeklyTargets: WeeklyTarget[];
  weekNumber: number | null;
  last7Days: RecentDay[];
};

/** Ringkasan lapangan per lokasi untuk /hari-ini. */
export async function getHariIniLocation(locationId: string): Promise<HariIniLocation | null> {
  const todayKey = jakartaDateKey(new Date());
  const today = parseDateKey(todayKey)!;
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { id: true, slug: true, name: true, village: true, regency: true },
  });
  if (!location) return null;

  const [todayReport, correctionReports, weeklyPlan, last7Days, cumulative] = await Promise.all([
    db.dailyReport.findUnique({
      where: { locationId_reportDate: { locationId, reportDate: today } },
      select: { status: true, _count: { select: { items: true } } },
    }),
    db.dailyReport.findMany({
      where: { locationId, status: "perlu_koreksi" },
      select: {
        reportDate: true,
        _count: { select: { items: true } },
        statusHistory: {
          where: { toStatus: "perlu_koreksi" },
          orderBy: { changedAt: "desc" },
          take: 1,
          select: { reason: true },
        },
      },
      orderBy: { reportDate: "asc" },
    }),
    db.weeklyPlan.findFirst({
      where: { locationId, weekStart: { lte: today }, weekEnd: { gte: today } },
      select: {
        weekNumber: true,
        items: {
          orderBy: { priority: "asc" },
          select: {
            targetVolume: true,
            priority: true,
            rabNode: { select: { name: true, unit: true, lineageKey: true } },
          },
        },
      },
    }),
    getRecentDays(locationId, 7),
    cumulativeVolumeByLineage(locationId),
  ]);

  return {
    ...location,
    todayDraftItemCount: todayReport ? todayReport._count.items : null,
    todayStatus: todayReport?.status ?? null,
    corrections: correctionReports.map((r) => ({
      dateKey: jakartaDateKey(r.reportDate),
      itemCount: r._count.items,
      reason: r.statusHistory[0]?.reason ?? null,
    })),
    weeklyTargets: (weeklyPlan?.items ?? []).map((it) => ({
      name: it.rabNode.name,
      unit: it.rabNode.unit,
      targetVolume: Number(it.targetVolume),
      realizedVolume: cumulative.get(it.rabNode.lineageKey) ?? 0,
      priority: it.priority,
    })),
    weekNumber: weeklyPlan?.weekNumber ?? null,
    last7Days,
  };
}

// ─────────────────────────────────────────────────────────────
// Data cetak KKP (finalSnapshot bila final, else live)
// ─────────────────────────────────────────────────────────────

const hariFmt = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "Asia/Jakarta" });
const tanggalFullFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" });

function snapshotToKkp(snap: FinalSnapshot): KkpDailyData {
  const d = parseDateKey(snap.reportDate)!;
  const workerMap: Partial<Record<WorkerRole, number>> = {};
  for (const w of snap.workers) workerMap[w.role] = w.count;
  return {
    locationName: snap.location.name,
    regency: snap.location.regency,
    province: snap.location.province,
    hari: hariFmt.format(d),
    tanggalFull: tanggalFullFmt.format(d),
    weekNo: snap.weekNo,
    tahunAnggaran: snap.tahunAnggaran,
    workerMap,
    totalWorkers: snap.totalWorkers,
    activeWeather: snap.weather ? WEATHER_KKP_CATEGORY[snap.weather] : null,
    workStart: snap.workStart,
    workEnd: snap.workEnd,
    notes: snap.notes,
    materials: snap.materials,
    equipment: snap.equipment,
    items: snap.items.map((it) => ({
      code: it.code,
      name: it.name,
      unit: it.unit,
      volumeContract: it.volumeContract,
      volumeBefore: it.volumeBefore,
      volumeToday: it.volumeToday,
      volumeCumulative: it.volumeCumulative,
      pctCumulative: it.pctCumulative,
    })),
    isFinal: true,
  };
}

/**
 * Data laporan harian KKP untuk halaman cetak. Sumber:
 *   status final → finalSnapshot beku (immutable), selain itu → hitung live.
 */
export async function getKkpDailyData(slug: string, dateKey: string): Promise<KkpDailyData | null> {
  const reportDate = parseDateKey(dateKey);
  if (!reportDate) return null;
  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      regency: true,
      province: true,
      package: { select: { contract: { select: { startDate: true } } } },
    },
  });
  if (!location) return null;

  const report = await db.dailyReport.findUnique({
    where: { locationId_reportDate: { locationId: location.id, reportDate } },
    include: {
      items: { include: { rabNode: true }, orderBy: { createdAt: "asc" } },
      workers: true,
      materials: { orderBy: { name: "asc" } },
      equipment: { orderBy: { name: "asc" } },
    },
  });

  if (report?.status === "final" && report.finalSnapshot) {
    return snapshotToKkp(report.finalSnapshot as unknown as FinalSnapshot);
  }

  const cumulative = await cumulativeVolumeByLineage(location.id, reportDate);
  const counted = report ? ["dikirim", "disetujui", "final"].includes(report.status) : false;
  const startDate = location.package.contract?.startDate ?? null;
  const weekNo = startDate
    ? Math.max(1, Math.floor((reportDate.getTime() - startDate.getTime()) / (7 * 86_400_000)) + 1)
    : null;

  const workerMap: Partial<Record<WorkerRole, number>> = {};
  for (const w of report?.workers ?? []) workerMap[w.role] = w.count;

  return {
    locationName: location.name,
    regency: location.regency,
    province: location.province,
    hari: hariFmt.format(reportDate),
    tanggalFull: tanggalFullFmt.format(reportDate),
    weekNo,
    tahunAnggaran: (startDate ?? reportDate).getUTCFullYear(),
    workerMap,
    totalWorkers: (report?.workers ?? []).reduce((n, w) => n + w.count, 0),
    activeWeather: report?.weather ? WEATHER_KKP_CATEGORY[report.weather] : null,
    workStart: report?.workStart ?? null,
    workEnd: report?.workEnd ?? null,
    notes: report?.notes ?? null,
    materials: (report?.materials ?? []).map((m) => ({
      name: m.name,
      unit: m.unit,
      qty: m.qtyReceived != null ? Number(m.qtyReceived) : null,
    })),
    equipment: (report?.equipment ?? []).map((e) => ({ name: e.name, count: e.count })),
    items: (report?.items ?? []).map((it) => {
      const volumeToday = Number(it.volumeDone);
      const base = cumulative.get(it.lineageKey) ?? 0;
      const volumeCumulative = Math.round((counted ? base : base + volumeToday) * 1000) / 1000;
      const volumeContract = it.rabNode.volume != null ? Number(it.rabNode.volume) : null;
      return {
        code: it.rabNode.code,
        name: it.rabNode.name,
        unit: it.rabNode.unit,
        volumeContract,
        volumeBefore: Math.max(0, Math.round((volumeCumulative - volumeToday) * 1000) / 1000),
        volumeToday,
        volumeCumulative,
        pctCumulative:
          volumeContract != null && volumeContract > 0 ? (volumeCumulative / volumeContract) * 100 : null,
      };
    }),
    isFinal: report?.status === "final",
  };
}
