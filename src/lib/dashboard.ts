import "server-only";
import { db } from "@/lib/db";
import { COUNTED_REPORT_STATUSES, getLocationsProgress } from "@/lib/progress";
import { weightedRealizedPct } from "@/lib/progress-calc";
import { getPetaMarkers, type PetaMarker } from "@/lib/peta";
import { buildPhotoViews, type PhotoView } from "@/lib/photos";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { REGION_ORDER, REGION_OTHER, regionOf } from "@/lib/region";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import type { IssueSeverity, IssueStatus, RecoveryStatus, DailyReportStatus } from "@/generated/prisma/enums";

/**
 * Data untuk Dashboard Eksekutif — komposisi dari lapisan yang sudah ada
 * (progress, peta, aktivitas, foto) menjadi satu ringkasan portofolio: submit
 * harian, deviasi, kendala tertunda, sebaran peta, dan Activity Centre. Semua
 * dibatasi ke lokasi yang boleh dilihat user (locIds=null = semua).
 */

// Level status progress TUNGGAL — jangan pernah ditulis ulang sebagai literal
// di modul mana pun (Calculation Integrity Protocol, DECISIONS 152).
const COUNTED: DailyReportStatus[] = [...COUNTED_REPORT_STATUSES];
const KRITIS_THRESHOLD = -10; // deviasi (pp) < -10 = kritis (butuh tindakan segera)

// ── Tipe hasil ────────────────────────────────────────────────────────────────
/** "idle" = lokasi TARGET (belum mulai) — bukan "belum submit hari ini". */
export type MarkerTone = "success" | "warning" | "danger" | "neutral" | "idle";

export type DashboardData = {
  updatedAt: Date;
  kpi: {
    totalLokasi: number;
    submittedToday: number;
    submittedDelta: number;
    submittedDeltaPct: number;
    notSubmittedToday: number;
    notSubmittedDelta: number;
    notSubmittedDeltaPct: number;
    submittedPct: number;
    notSubmittedPct: number;
    totalReportsToday: number;
    deviasiKritis: number;
  };
  belumSubmit: { id: string; name: string; slug: string; lastReportDate: Date | null }[];
  perluPerhatian: { id: string; name: string; slug: string; deviationPct: number }[];
  deviasiRanking: { id: string; name: string; slug: string; planPct: number; realizedPct: number; deviationPct: number }[];
  regions: { region: string; count: number }[];
  kendala: {
    id: string;
    title: string;
    severity: IssueSeverity;
    status: IssueStatus;
    locationName: string;
    locationSlug: string;
    pic: string | null;
    dueDate: Date | null;
    recoveryStatus: RecoveryStatus | null;
    late: boolean;
  }[];
  kendalaOpen: number;
  kendalaKritis: number;
  markers: PetaMarker[];
  markerTone: Record<string, MarkerTone>;
  locationsIndex: { name: string; slug: string }[];
  // Portofolio & administrasi (gabungan dari Command Center).
  finance: { totalContract: bigint; totalRealized: bigint; realizedPct: number };
  paketAktif: number;
  menungguVerifikasi: number;
  perluKoreksi: number;
};

export type ActivityCentreItem = {
  id: string;
  at: Date;
  locationName: string;
  locationSlug: string;
  type: string;
  typeLabel: string;
  title: string;
  hasKendala: boolean;
  hasSolusi: boolean;
  photoCount: number;
  thumbs: PhotoView[];
  deviationPct: number | null;
};

const SEVERITY_RANK: Record<IssueSeverity, number> = { kritis: 0, tinggi: 1, sedang: 2, rendah: 3 };

/** Data utama dashboard (KPI, submit, deviasi, kendala, peta, portofolio). */
export async function getDashboardData(locIds: string[] | null, orgId: string): Promise<DashboardData> {
  // null = semua lokasi ORGANISASI, bukan semua lokasi database (audit B11).
  const locWhere = locIds === null ? { package: { orgId } } : { id: { in: locIds } };
  const today = parseDateKey(jakartaDateKey(new Date()))!;
  const yesterday = new Date(today.getTime() - 86_400_000);

  const [locations, submittedTodayRows, submittedYdayRows, activitiesTodayCount, markers, paketAktif, menungguVerifikasi, perluKoreksi, allLocations] = await Promise.all([
    db.location.findMany({
      where: { ...locWhere, isActive: true },
      select: { id: true, name: true, slug: true, province: true, status: true },
      orderBy: { name: "asc" },
    }),
    db.dailyReport.findMany({
      where: { location: locWhere, reportDate: today, status: { in: COUNTED } },
      select: { locationId: true },
    }),
    db.dailyReport.findMany({
      where: { location: locWhere, reportDate: yesterday, status: { in: COUNTED } },
      select: { locationId: true },
    }),
    db.fieldActivity.count({ where: { location: locWhere, activityDate: today } }),
    getPetaMarkers(locIds, orgId),
    db.package.count({ where: { orgId, stage: { notIn: ["selesai", "batal"] } } }),
    db.dailyReport.count({ where: { location: locWhere, status: "dikirim" } }),
    db.dailyReport.count({ where: { location: locWhere, status: "perlu_koreksi" } }),
    // Sebaran wilayah memotret SELURUH lokasi (termasuk yang belum mulai),
    // sama dengan populasi pin peta — dulu kartu ini hanya menghitung lokasi
    // berjalan sehingga Bali/NTB tampil 0 padahal pin-nya ada di peta
    // (temuan 2026-07-27).
    db.location.findMany({ where: locWhere, select: { province: true } }),
  ]);

  const ids = locations.map((l) => l.id);
  const progress = await getLocationsProgress(ids);
  const lastReport = await lastReportDateByLocation(ids);

  let totalContract = 0n;
  let totalRealized = 0n;
  for (const p of progress.values()) {
    totalContract += p.grandTotal;
    totalRealized += p.realizedValue;
  }
  // Formula kanonik (B13) — varian BigInt lama memotong desimal.
  const realizedPct = weightedRealizedPct([...progress.values()]);

  const submittedIds = new Set(submittedTodayRows.map((r) => r.locationId));
  const submittedToday = submittedIds.size;
  const submittedYday = new Set(submittedYdayRows.map((r) => r.locationId)).size;
  const total = locations.length;
  const notSubmittedToday = Math.max(0, total - submittedToday);
  const notSubmittedYday = Math.max(0, total - submittedYday);

  const belumSubmit = locations
    .filter((l) => !submittedIds.has(l.id))
    .map((l) => ({ id: l.id, name: l.name, slug: l.slug, lastReportDate: lastReport.get(l.id) ?? null }))
    .sort((a, b) => (a.lastReportDate?.getTime() ?? 0) - (b.lastReportDate?.getTime() ?? 0));

  const withDev = locations
    .map((l) => ({ l, p: progress.get(l.id) }))
    .filter((x) => x.p)
    .map((x) => ({ id: x.l.id, name: x.l.name, slug: x.l.slug, planPct: x.p!.planPct, realizedPct: x.p!.realizedPct, deviationPct: x.p!.deviationPct }));

  const perluPerhatian = withDev
    .filter((x) => x.deviationPct < 0)
    .sort((a, b) => a.deviationPct - b.deviationPct);
  const deviasiRanking = [...withDev].sort((a, b) => a.deviationPct - b.deviationPct);
  const deviasiKritis = withDev.filter((x) => x.deviationPct < KRITIS_THRESHOLD).length;

  // Sebaran region — SEMUA lokasi (bukan hanya yg punya GPS / yg sudah berjalan).
  const regionCount = new Map<string, number>();
  for (const l of allLocations) {
    const r = regionOf(l.province);
    regionCount.set(r, (regionCount.get(r) ?? 0) + 1);
  }
  // "Lainnya" ikut ditampilkan bila terisi — provinsi yang belum dikenali harus
  // KELIHATAN (Σ kartu wilayah = jumlah lokasi), bukan hilang diam-diam.
  const regions = [
    ...REGION_ORDER.map((r) => ({ region: r as string, count: regionCount.get(r) ?? 0 })),
    ...(regionCount.get(REGION_OTHER) ? [{ region: REGION_OTHER, count: regionCount.get(REGION_OTHER)! }] : []),
  ];

  // Warna pin peta = status submit + deviasi.
  const markerTone: Record<string, MarkerTone> = {};
  for (const m of markers) {
    const p = progress.get(m.id);
    // Lokasi belum mulai tidak diminta lapor hari ini — jangan diwarnai
    // "belum submit" seolah menunggak.
    if (!m.isActive) markerTone[m.id] = "idle";
    else if (p && p.deviationPct < KRITIS_THRESHOLD) markerTone[m.id] = "danger";
    else if (!submittedIds.has(m.id)) markerTone[m.id] = "neutral";
    else if (p && p.deviationPct < 0) markerTone[m.id] = "warning";
    else markerTone[m.id] = "success";
  }

  // Kendala & solusi tertunda (issue terbuka/ditangani + aksi pemulihan terbaru).
  const issues = await db.issue.findMany({
    where: { location: locWhere, status: { in: ["terbuka", "ditangani"] } },
    select: {
      id: true,
      title: true,
      severity: true,
      status: true,
      location: { select: { name: true, slug: true } },
      actions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { picName: true, dueDate: true, status: true },
      },
    },
  });
  const kendalaAll = issues.map((i) => {
    const act = i.actions[0];
    const late = !!act?.dueDate && act.dueDate < today && act.status !== "selesai";
    return {
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      locationName: i.location.name,
      locationSlug: i.location.slug,
      pic: act?.picName ?? null,
      dueDate: act?.dueDate ?? null,
      recoveryStatus: act?.status ?? null,
      late,
    };
  });
  kendalaAll.sort((a, b) => {
    if (a.late !== b.late) return a.late ? -1 : 1;
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
  });

  return {
    updatedAt: new Date(),
    kpi: {
      totalLokasi: total,
      submittedToday,
      submittedDelta: submittedToday - submittedYday,
      submittedDeltaPct: pctDelta(submittedToday, submittedYday),
      notSubmittedToday,
      notSubmittedDelta: notSubmittedToday - notSubmittedYday,
      notSubmittedDeltaPct: pctDelta(notSubmittedToday, notSubmittedYday),
      submittedPct: total > 0 ? Math.round((submittedToday / total) * 1000) / 10 : 0,
      notSubmittedPct: total > 0 ? Math.round((notSubmittedToday / total) * 1000) / 10 : 0,
      totalReportsToday: submittedToday + activitiesTodayCount,
      deviasiKritis,
    },
    belumSubmit,
    perluPerhatian,
    deviasiRanking,
    regions,
    kendala: kendalaAll,
    kendalaOpen: kendalaAll.length,
    kendalaKritis: kendalaAll.filter((k) => k.severity === "kritis").length,
    markers,
    markerTone,
    locationsIndex: locations.map((l) => ({ name: l.name, slug: l.slug })),
    finance: { totalContract, totalRealized, realizedPct },
    paketAktif,
    menungguVerifikasi,
    perluKoreksi,
  };
}

/** Activity Centre: kegiatan lapangan terbaru lintas lokasi + thumbnail foto. */
export async function getActivityCentre(locIds: string[] | null, limit = 6): Promise<ActivityCentreItem[]> {
  const locWhere = locIds === null ? {} : { id: { in: locIds } };
  const acts = await db.fieldActivity.findMany({
    where: { location: locWhere },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      type: true,
      createdAt: true,
      kendala: true,
      solusi: true,
      locationId: true,
      location: { select: { name: true, slug: true } },
      _count: { select: { photos: true } },
      photos: {
        orderBy: { createdAt: "asc" },
        take: 4,
        select: { id: true, r2Key: true, thumbnailKey: true, exifTakenAt: true, exifGpsLat: true, exifGpsLng: true },
      },
    },
  });

  const flatPhotos = acts.flatMap((a) => a.photos);
  const views = await buildPhotoViews(flatPhotos);
  const viewById = new Map(views.map((v) => [v.id, v]));

  const [progress, kindLabels] = await Promise.all([
    getLocationsProgress([...new Set(acts.map((a) => a.locationId))]),
    getActivityKindLabelMap(),
  ]);

  return acts.map((a) => ({
    id: a.id,
    at: a.createdAt,
    locationName: a.location.name,
    locationSlug: a.location.slug,
    type: a.type,
    typeLabel: kindLabels.get(a.type) ?? a.type,
    title: a.title,
    hasKendala: !!a.kendala?.trim(),
    hasSolusi: !!a.solusi?.trim(),
    photoCount: a._count.photos,
    thumbs: a.photos.map((p) => viewById.get(p.id)).filter((v): v is PhotoView => !!v),
    deviationPct: progress.get(a.locationId)?.deviationPct ?? null,
  }));
}

// ── util ──
function pctDelta(now: number, prev: number): number {
  if (prev === 0) return now === 0 ? 0 : 100;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

/** Tanggal laporan terakhir per lokasi (untuk "belum submit — update terakhir"). */
async function lastReportDateByLocation(ids: string[]): Promise<Map<string, Date>> {
  if (ids.length === 0) return new Map();
  const rows = await db.dailyReport.findMany({
    where: { locationId: { in: ids } },
    distinct: ["locationId"],
    orderBy: [{ locationId: "asc" }, { reportDate: "desc" }],
    select: { locationId: true, reportDate: true },
  });
  return new Map(rows.map((r) => [r.locationId, r.reportDate]));
}
