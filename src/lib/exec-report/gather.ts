import "server-only";
import { db } from "@/lib/db";
import { parseDateKey } from "@/lib/format";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";

/**
 * Kumpulkan data terstruktur untuk laporan eksekutif — kegiatan, status laporan
 * harian, dan kendala terbuka per lokasi dalam periode. Dibatasi ke lokasi yang
 * boleh diakses user (peran cross-location = semua di org). DECISIONS 122.
 */

export type ExecLocationData = {
  name: string;
  province: string;
  packageName: string;
  activities: { label: string; title: string; final: boolean }[];
  reportStatus: string | null; // status laporan terbaru dalam periode; null = belum lapor
  weather: string | null;
  openIssues: { severity: string; title: string }[];
};

export type ExecData = {
  periodStart: string;
  periodEnd: string;
  totalLocations: number;
  reportedCount: number;
  locations: ExecLocationData[];
};

function weatherLabel(w: string | null): string | null {
  return w ? w.replace(/_/g, " ") : null;
}

export async function gatherExecData(
  user: SessionUser,
  startKey: string,
  endKey: string,
): Promise<ExecData> {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end) throw new Error("Rentang tanggal tidak valid.");

  const locIds = await accessibleLocationIds(user);
  const locations = await db.location.findMany({
    where: {
      ...(locIds ? { id: { in: locIds } } : {}),
      package: { orgId: user.orgId },
    },
    select: { id: true, name: true, province: true, package: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const ids = locations.map((l) => l.id);
  if (ids.length === 0) {
    return { periodStart: startKey, periodEnd: endKey, totalLocations: 0, reportedCount: 0, locations: [] };
  }

  const [acts, reports, issues, kindMap] = await Promise.all([
    db.fieldActivity.findMany({
      where: { locationId: { in: ids }, activityDate: { gte: start, lte: end } },
      select: { locationId: true, type: true, title: true, status: true },
      orderBy: { activityDate: "asc" },
    }),
    db.dailyReport.findMany({
      where: { locationId: { in: ids }, reportDate: { gte: start, lte: end } },
      select: { locationId: true, status: true, weather: true, reportDate: true },
      orderBy: { reportDate: "desc" },
    }),
    db.issue.findMany({
      where: { locationId: { in: ids }, status: { in: ["terbuka", "ditangani"] } },
      select: { locationId: true, severity: true, title: true },
    }),
    getActivityKindLabelMap(),
  ]);

  const actsByLoc = new Map<string, ExecLocationData["activities"]>();
  for (const a of acts) {
    const arr = actsByLoc.get(a.locationId) ?? [];
    arr.push({ label: kindMap.get(a.type) ?? a.type, title: a.title, final: a.status === "final" });
    actsByLoc.set(a.locationId, arr);
  }
  // Laporan terbaru per lokasi (list sudah desc → yang pertama ditemui = terbaru).
  const reportByLoc = new Map<string, { status: string; weather: string | null }>();
  for (const r of reports) {
    if (!reportByLoc.has(r.locationId)) {
      reportByLoc.set(r.locationId, { status: r.status, weather: r.weather ?? null });
    }
  }
  const issuesByLoc = new Map<string, ExecLocationData["openIssues"]>();
  for (const i of issues) {
    const arr = issuesByLoc.get(i.locationId) ?? [];
    arr.push({ severity: i.severity, title: i.title });
    issuesByLoc.set(i.locationId, arr);
  }

  const out: ExecLocationData[] = locations.map((l) => {
    const rep = reportByLoc.get(l.id) ?? null;
    return {
      name: l.name,
      province: l.province,
      packageName: l.package.name,
      activities: actsByLoc.get(l.id) ?? [],
      reportStatus: rep?.status ?? null,
      weather: weatherLabel(rep?.weather ?? null),
      openIssues: issuesByLoc.get(l.id) ?? [],
    };
  });

  return {
    periodStart: startKey,
    periodEnd: endKey,
    totalLocations: out.length,
    reportedCount: out.filter((l) => l.reportStatus !== null).length,
    locations: out,
  };
}
