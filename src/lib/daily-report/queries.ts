import "server-only";
import { pilihPelaksana } from "@/lib/laporan/penandatangan";
import { db } from "@/lib/db";
import { bobotPct, prestasiPct } from "@/lib/progress-calc";
import { COUNTED_REPORT_STATUSES, cumulativeVolumeByLineage, getLocationProgress } from "@/lib/progress";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { buildPhotoViews, type PhotoView } from "@/lib/photos";
import type {
  DailyReportStatus,
  IssueSeverity,
  IssueStatus,
  WeatherCode,
  WeatherSource,
  WorkerRole,
  NoActivityReason,
} from "@/generated/prisma/enums";
import { hourlyCategoryEntries, parseHourlyWeather, type HourlyWeather } from "@/lib/weather/hourly";
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
  /**
   * `aktif` = item RAB kontrak · `draft_adendum` = item dari draft adendum yang
   * BELUM resmi (DECISIONS 210). Yang draft ditandai di daftar pilihan supaya
   * pelapor tahu ia sedang mencatat pekerjaan yang belum punya dasar kontrak.
   */
  basis: "aktif" | "draft_adendum";
};

/**
 * Leaf item RAB + sisa volume, siap untuk pencarian di klien.
 *
 * Mencakup revisi AKTIF dan — bila ada — DRAFT adendum. Item draft yang
 * lineage-nya SAMA dengan item aktif tidak digandakan: yang muncul adalah versi
 * aktifnya, karena pekerjaan itu masih punya dasar kontrak. Yang benar-benar
 * baru (atau volumenya dinaikkan melampaui kontrak) hanya ada di draft, dan
 * itulah yang perlu dilaporkan lewat basis draft.
 */
export async function getLeafNodeOptions(locationId: string): Promise<LeafNodeOption[]> {
  const revision = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  const draft = await db.rabRevision.findFirst({
    where: { locationId, status: "draft" },
    select: { id: true },
  });
  if (!revision && !draft) return [];

  const [nodes, cumulative] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: { in: [revision?.id, draft?.id].filter((x): x is string => !!x) } },
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
        revisionId: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
    cumulativeVolumeByLineage(locationId, undefined, "semua"),
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

  // Item aktif menang atas item draft dengan lineage yang sama — melaporkan
  // lewat basis draft padahal masih ada dasar kontrak hanya akan membuat
  // pekerjaan yang sah tidak terhitung di angka resmi.
  const lineageAktif = new Set(
    nodes.filter((n) => n.kind === "item" && n.revisionId === revision?.id).map((n) => n.lineageKey),
  );

  return nodes
    .filter(
      (n) =>
        n.kind === "item" &&
        (n.revisionId === revision?.id || !lineageAktif.has(n.lineageKey)),
    )
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
        basis: n.revisionId === revision?.id ? ("aktif" as const) : ("draft_adendum" as const),
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
  /** Kondisi per jam 07–21 bila sudah diambil otomatis dari layanan cuaca. */
  weatherHourly: HourlyWeather[] | null;
  weatherSource: WeatherSource | null;
  weatherFetchedAt: string | null;
  workStart: string | null;
  workEnd: string | null;
  notes: string | null;
  /** Pernyataan "hari ini tidak ada kegiatan" (DECISIONS 396). */
  noActivity: boolean;
  noActivityReason: NoActivityReason | null;
  noActivityNote: string | null;
  items: WorkspaceItem[];
  totalValueToday: string; // BigInt string
  workers: { role: WorkerRole; count: number }[];
  materials: { id: string; name: string; unit: string | null; qty: number | null; photos: PhotoView[] }[];
  equipment: { id: string; name: string; count: number; photos: PhotoView[] }[];
  history: WorkspaceHistoryRow[];
  issues: WorkspaceIssue[];
  photos: PhotoView[];
  /** Foto yang tidak menempel ke item mana pun (item-nya sudah dihapus). */
  photosTanpaItem: PhotoView[];
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
        // Urut RAB (sortOrder), bukan urutan input — konsisten antar hari.
        items: { include: { rabNode: true }, orderBy: { rabNode: { sortOrder: "asc" } } },
        workers: true,
        materials: { orderBy: { name: "asc" } },
        equipment: { orderBy: { name: "asc" } },
        statusHistory: { orderBy: { changedAt: "asc" } },
        photos: { orderBy: { createdAt: "asc" } },
        issues: { where: { mergedIntoId: null }, orderBy: { createdAt: "asc" } },
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
  // Foto TANPA item (yatim). Terjadi saat item pekerjaannya dihapus: fotonya
  // sengaja dilepas, bukan ikut terhapus. Dulu foto begini tidak ditampilkan di
  // mana pun sehingga mustahil dibersihkan — sekarang dipisahkan supaya tetap
  // terlihat dan bisa dihapus. Statusnya DITURUNKAN (reportItemId kosong),
  // bukan disimpan sebagai flag yang bisa melenceng dari kenyataan.
  const photoByItem = new Map<string, PhotoView[]>();
  const photoByMaterial = new Map<string, PhotoView[]>();
  const photoByEquipment = new Map<string, PhotoView[]>();
  const photosTanpaItem: PhotoView[] = [];
  for (const p of photoViews) {
    /*
     * Bukti MATERIAL / ALAT bukan foto yatim (DECISIONS 304).
     *
     * "Yatim" diturunkan dari `reportItemId` yang kosong — dan foto material
     * memang TIDAK PERNAH punya reportItemId. Tanpa cabang ini, ia mendarat di
     * panel "Foto tanpa pekerjaan" yang mengajak orang membersihkannya:
     * sistem akan menyuruh menghapus bukti yang justru sah.
     */
    if (p.reportMaterialId) {
      const arr = photoByMaterial.get(p.reportMaterialId) ?? [];
      arr.push(p);
      photoByMaterial.set(p.reportMaterialId, arr);
      continue;
    }
    if (p.reportEquipmentId) {
      const arr = photoByEquipment.get(p.reportEquipmentId) ?? [];
      arr.push(p);
      photoByEquipment.set(p.reportEquipmentId, arr);
      continue;
    }
    if (!p.reportItemId) {
      photosTanpaItem.push(p);
      continue;
    }
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
  const counted = new Set<DailyReportStatus>(COUNTED_REPORT_STATUSES);
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
      // Dibatasi 100% memakai formula yang sama dengan blanko mingguan/bulanan
      // (DECISIONS 151) — item yang sama tidak boleh 110% di harian tapi 100%
      // di mingguan.
      pctCumulative:
        volumeContract != null && volumeContract > 0 ? prestasiPct(volumeCumulative, volumeContract) : null,
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
      weatherHourly: parseHourlyWeather(report.weatherHourly),
      weatherSource: report.weatherSource,
      weatherFetchedAt: report.weatherFetchedAt?.toISOString() ?? null,
      workStart: report.workStart,
      workEnd: report.workEnd,
      notes: report.notes,
      items,
      totalValueToday: totalValueToday.toString(),
      workers: report.workers.map((w) => ({ role: w.role, count: w.count })),
      materials: report.materials.map((m) => ({
      photos: photoByMaterial.get(m.id) ?? [],
        id: m.id,
        name: m.name,
        unit: m.unit,
        qty: m.qtyReceived != null ? Number(m.qtyReceived) : null,
      })),
      equipment: report.equipment.map((e) => ({
      photos: photoByEquipment.get(e.id) ?? [], id: e.id, name: e.name, count: e.count })),
      history: report.statusHistory.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedAt: h.changedAt.toISOString(),
        changedByName: nameById.get(h.changedById) ?? "–",
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
      photosTanpaItem,
      lastCorrectionReason: lastCorrection?.reason ?? null,
      noActivity: report.noActivity,
      noActivityReason: report.noActivityReason,
      noActivityNote: report.noActivityNote,
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
// TANPA nama hari — nama hari sudah disediakan `hari` secara terpisah. Dulu
// `dateStyle: "full"` memuat nama hari juga, sehingga setiap penggabungan
// "hari + tanggal" menghasilkan sebutan ganda: blanko harian menulis
// "Hari: Minggu" lalu "Tanggal: Minggu, 26 Juli 2026", dan caption WhatsApp
// bahkan "Minggu, Minggu, 26 Juli 2026" (temuan user 2026-07-27).
const tanggalFullFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" });
// Jumlah material di keterangan foto — konvensi id-ID, sama dengan blanko (FMT-01).
const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

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
    weatherByHour: snap.weatherHourly ? hourlyCategoryEntries(snap.weatherHourly) : null,
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
 * Peta lineageKey item → kategori (bangunan) induknya di RAB AKTIF.
 *
 * Akar lineage = segmen pertama ("V#3.1#b" → "V"), aturan yang sama dengan
 * `periodic-report`. Kategori yang sudah tidak ada di revisi aktif (mis. item
 * dihapus adendum) mengembalikan null — ditulis apa adanya, bukan ditebak.
 */
async function kategoriLookup(
  locationId: string,
): Promise<(lineageKey: string | null) => { categoryCode: string | null; categoryName: string | null }> {
  const revision = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  if (!revision) return () => ({ categoryCode: null, categoryName: null });
  const kategori = await db.rabNode.findMany({
    where: { revisionId: revision.id, kind: "kategori" },
    select: { lineageKey: true, code: true, name: true },
  });
  const byKey = new Map(kategori.map((k) => [k.lineageKey, k]));
  return (lineageKey) => {
    const k = lineageKey ? byKey.get(lineageKey.split("#")[0]) : undefined;
    return { categoryCode: k?.code ?? null, categoryName: k?.name ?? null };
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
      pelaksanaName: true,
      pelaksanaTitle: true,
      pelaksanaTtdKey: true,
      pelaksanaStempelKey: true,
      package: {
        select: {
          pelaksanaName: true,
          pelaksanaTitle: true,
          pelaksanaTtdKey: true,
          pelaksanaStempelKey: true,
          contract: {
            select: {
              startDate: true,
              workTitle: true,
              contractNumber: true,
              signedDate: true,
              supervisorName: true,
              supervisorFirm: true,
              contractorSignerName: true,
              contractorSignerTitle: true,
              vendor: { select: { name: true, logoKey: true, address: true } },
            },
          },
        },
      },
    },
  });
  if (!location) return null;

  const contract = location.package.contract;
  /*
   * Laporan HARIAN diteken PELAKSANA LAPANGAN, bukan direktur (DECISIONS 402).
   *
   * Sebelum ini blok "Dibuat Oleh" memuat `contractorSignerName` — nama
   * direktur — pada dokumen yang diisi dan ditandatangani orang lapangan.
   * Nama yang belum diisi dibiarkan null: tercetak sebagai baris kosong untuk
   * ditandatangani tangan, TIDAK jatuh ke nama direktur.
   */
  const pelaksana = pilihPelaksana(location, location.package);
  const signatories = {
    supervisorName: contract?.supervisorName ?? null,
    supervisorSub: contract?.supervisorFirm ?? null,
    contractorName: pelaksana.nama,
    contractorSub: pelaksana.jabatan,
    // Nama perusahaan untuk kop blanko (posisi "logo perusahaan" di contoh KKP).
    supervisorFirm: contract?.supervisorFirm ?? null,
    contractorFirm: contract?.vendor?.name ?? null,
  };

  // Identitas pemilik pekerjaan untuk kop — dari menu Sistem, bukan hardcode
  // KKP (DECISIONS 166). Logo dipresign singkat; kegagalan R2 tidak boleh
  // menggagalkan laporan, cukup kop tanpa logo.
  const { getBranding } = await import("@/lib/branding");
  const brand = await getBranding();
  let ownerLogoUrl: string | null = null;
  if (brand.ownerLogoKey) {
    try {
      const { r2PresignGet } = await import("@/lib/r2");
      ownerLogoUrl = await r2PresignGet(brand.ownerLogoKey, 600);
    } catch {
      ownerLogoUrl = null;
    }
  }
  const owner = {
    ownerName: brand.ownerName,
    ownerSubtitle: brand.ownerSubtitle,
    ownerAddress: brand.ownerAddress,
    ownerLogoUrl,
    pekerjaan: contract?.workTitle ?? null,
  };

  // Kolom "RENCANA PEKERJAAN" blanko: rencana MINGGUAN dipecah ke hari ini
  // menurut alur & metode kerja (DECISIONS 163). Tanpa rencana mingguan,
  // kolomnya kosong seperti blanko cetak.
  const rencana = await rencanaHarianUntukTanggal(location.id, reportDate);

  const report = await db.dailyReport.findUnique({
    where: { locationId_reportDate: { locationId: location.id, reportDate } },
    include: {
      items: { include: { rabNode: true }, orderBy: { rabNode: { sortOrder: "asc" } } },
      workers: true,
      materials: { orderBy: { name: "asc" } },
      equipment: { orderBy: { name: "asc" } },
      // Halaman DOKUMENTASI PEKERJAAN (DECISIONS 299) — foto beserta item RAB
      // yang dibuktikannya. Tautannya sudah ada; tinggal diambil.
      photos: {
        select: {
          id: true,
          r2Key: true,
          reportItem: { select: { rabNode: { select: { name: true, lineageKey: true } } } },
          // Bukti material & alat (DECISIONS 304) — dicetak di halamannya
          // sendiri, bukan dicampur ke foto pekerjaan.
          reportMaterial: { select: { name: true, unit: true, qtyReceived: true } },
          reportEquipment: { select: { name: true, count: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  // Bangunan/kategori tiap item — blanko harian hanya menulis uraian pekerjaan,
  // padahal satu lokasi punya belasan bangunan dan nama item sering sama persis
  // antar bangunan ("Pembesian", "Galian"). Tanpa ini pembaca tidak tahu
  // pekerjaan itu di bangunan yang mana (permintaan user 2026-08-02).
  //
  // Sengaja DITURUNKAN dari lineageKey, bukan dibekukan ke finalSnapshot:
  // snapshot lama sudah menyimpan lineageKey, jadi laporan yang TERLANJUR final
  // pun langsung memuat kategorinya tanpa perlu bangun ulang snapshot. Ini
  // label, bukan angka — jadi tidak melanggar keimutabelan angka snapshot.
  const kategoriByRoot = await kategoriLookup(location.id);

  // Baris laporan yang basisnya DRAFT ADENDUM (DECISIONS 215). Blanko harian
  // KKP adalah dokumen resmi — pekerjaan atas usulan adendum belum punya dasar
  // kontrak, jadi tidak boleh ikut tercetak di sana. Dihitung dari baris
  // laporan yang MASIH tersimpan, bukan dari snapshot: laporan yang terlanjur
  // final SEBELUM aturan ini ada sudah membekukan baris draft ke dalam
  // snapshot-nya, dan cara ini membersihkannya tanpa perlu bangun ulang.
  const lineageDraft = new Set(
    (report?.items ?? []).filter((it) => it.basis !== "aktif").map((it) => it.lineageKey),
  );

  const startDate = location.package.contract?.startDate ?? null;
  const weekNo = startDate
    ? Math.max(1, Math.floor((reportDate.getTime() - startDate.getTime()) / (7 * 86_400_000)) + 1)
    : null;

  /**
   * Bobot hari ini per item — kolom "Bobot (%)" di halaman dokumentasi.
   *
   * Memakai `bobotPct` dari progress-calc; TIDAK ada rumus baru di sini
   * (CLAUDE.md butir 7). Grand total nol → tidak diisi sama sekali: "belum
   * diketahui" berbeda dari "nol persen".
   *
   * Diturunkan dari baris laporan yang tersimpan, BUKAN dari finalSnapshot:
   * snapshot tidak pernah membekukan bobot sama sekali, jadi tidak ada angka
   * beku yang bisa dilanggar di sini. Sama seperti kategori (lihat di atas),
   * ini keterangan di kartu foto — bukan angka volume yang dibekukan.
   */
  const bobotPerLineage = new Map<string, number>();
  {
    const { grandTotal } = await getLocationProgress(location.id, { asOf: reportDate });
    if (grandTotal > 0n)
      for (const it of report?.items ?? []) {
        if (it.basis !== "aktif") continue;
        bobotPerLineage.set(it.lineageKey, bobotPct(Number(it.valueDone), Number(grandTotal)));
      }
  }

  /*
   * ── Sampul & dokumentasi (DECISIONS 299) ────────────────────────────────
   *
   * DI LUAR percabangan final/pratinjau, dan itu memang inti perbaikannya.
   * Sebelumnya blok ini hanya ada di cabang pratinjau, sehingga laporan yang
   * SUDAH final — satu-satunya yang benar-benar dikirim ke KKP — kehilangan
   * nomor kontrak, periode, dan SELURUH halaman dokumentasi fotonya. Bug itu
   * tidak terlihat saat menguji pratinjau, karena di sana semuanya lengkap
   * (laporan user 2026-08-07: "cetak harian final juga, halaman fotonya tidak
   * ada").
   *
   * Foto & identitas kontrak bukan angka progres, jadi mengambilnya dari data
   * hidup tidak menyentuh keimutabelan snapshot.
   */
  const periode = (w: number | null) => ({
    // Periode minggu berjalan: diturunkan dari tanggal SPMK + nomor minggu yang
    // SUDAH dipakai blanko — satu sumber, jadi sampul dan blanko tidak bisa
    // menyebut minggu yang berbeda.
    periodStart:
      startDate && w
        ? tanggalFullFmt.format(new Date(startDate.getTime() + (w - 1) * 7 * 86_400_000))
        : null,
    periodEnd:
      startDate && w
        ? tanggalFullFmt.format(new Date(startDate.getTime() + (w * 7 - 1) * 86_400_000))
        : null,
  });
  const lampiran = {
    contractNumber: contract?.contractNumber ?? null,
    contractDate: contract?.signedDate ? tanggalFullFmt.format(contract.signedDate) : null,
    contractorAddress: contract?.vendor?.address ?? null,
    vendorLogoKey: contract?.vendor?.logoKey ?? null,
    /*
     * Foto DIPILAH menurut apa yang dibuktikannya (DECISIONS 304).
     *
     * `photos` sengaja hanya memuat bukti PEKERJAAN. Kalau foto material ikut
     * masuk ke sini, ia akan tercetak di halaman dokumentasi pekerjaan dengan
     * label "(tanpa item pekerjaan)" — terbaca seperti foto yang lupa
     * ditautkan, padahal ia memang bukan foto pekerjaan.
     */
    photos: (report?.photos ?? [])
      .filter((ph) => ph.reportMaterial == null && ph.reportEquipment == null)
      .map((ph) => {
        const kunci = ph.reportItem?.rabNode?.lineageKey ?? null;
        return {
          id: ph.id,
          r2Key: ph.r2Key,
          pekerjaan: ph.reportItem?.rabNode?.name ?? null,
          kategori: kunci ? (kategoriByRoot(kunci).categoryName ?? null) : null,
          // Bobot DIAMBIL dari baris laporannya, tidak dihitung ulang di PDF.
          bobot: kunci ? (bobotPerLineage.get(kunci) ?? null) : null,
        };
      }),
    materialPhotos: (report?.photos ?? [])
      .filter((ph) => ph.reportMaterial != null)
      .map((ph) => ({
        id: ph.id,
        r2Key: ph.r2Key,
        nama: ph.reportMaterial!.name,
        // Keterangan jumlah ditulis APA ADANYA dari baris materialnya; kalau
        // jumlahnya tidak diisi, tidak dikarang jadi nol.
        keterangan:
          ph.reportMaterial!.qtyReceived != null
            ? `${volFmt.format(Number(ph.reportMaterial!.qtyReceived))}${ph.reportMaterial!.unit ? ` ${ph.reportMaterial!.unit}` : ""}`
            : null,
      })),
    equipmentPhotos: (report?.photos ?? [])
      .filter((ph) => ph.reportEquipment != null)
      .map((ph) => ({
        id: ph.id,
        r2Key: ph.r2Key,
        nama: ph.reportEquipment!.name,
        keterangan: `${ph.reportEquipment!.count} unit`,
      })),
  };

  if (report?.status === "final" && report.finalSnapshot) {
    const snap = report.finalSnapshot as unknown as FinalSnapshot;
    const base = snapshotToKkp(snap);
    const dipakai = base.items
      .map((it, i) => ({ it, lineageKey: snap.items[i]?.lineageKey ?? null }))
      .filter((r) => !(r.lineageKey != null && lineageDraft.has(r.lineageKey)));
    return {
      ...base,
      items: dipakai.map((r) => ({ ...r.it, ...kategoriByRoot(r.lineageKey) })),
      // Snapshot baru sudah menyimpan angkanya; snapshot lama dihitung dari
      // selisih baris yang disaring di sini.
      draftItemCount: snap.itemsDraftAdendum ?? base.items.length - dipakai.length,
      ...signatories,
      ...owner,
      rencana,
      ...lampiran,
      // Nomor minggu yang DIBEKUKAN snapshot, bukan hitungan ulang — supaya
      // sampul menyebut minggu yang sama dengan blanko di halaman berikutnya.
      ...periode(base.weekNo),
    };
  }

  const cumulative = await cumulativeVolumeByLineage(location.id, reportDate);
  const counted = report
    ? (COUNTED_REPORT_STATUSES as readonly string[]).includes(report.status)
    : false;

  const workerMap: Partial<Record<WorkerRole, number>> = {};
  for (const w of report?.workers ?? []) workerMap[w.role] = w.count;

  return {
    ...owner,
    rencana,
    locationName: location.name,
    regency: location.regency,
    province: location.province,
    hari: hariFmt.format(reportDate),
    tanggalFull: tanggalFullFmt.format(reportDate),
    weekNo,
    ...lampiran,
    ...periode(weekNo),
    tahunAnggaran: (startDate ?? reportDate).getUTCFullYear(),
    workerMap,
    totalWorkers: (report?.workers ?? []).reduce((n, w) => n + w.count, 0),
    activeWeather: report?.weather ? WEATHER_KKP_CATEGORY[report.weather] : null,
    weatherByHour: (() => {
      const h = parseHourlyWeather(report?.weatherHourly);
      return h ? hourlyCategoryEntries(h) : null;
    })(),
    workStart: report?.workStart ?? null,
    workEnd: report?.workEnd ?? null,
    notes: report?.notes ?? null,
    materials: (report?.materials ?? []).map((m) => ({
      name: m.name,
      unit: m.unit,
      qty: m.qtyReceived != null ? Number(m.qtyReceived) : null,
    })),
    equipment: (report?.equipment ?? []).map((e) => ({ name: e.name, count: e.count })),
    draftItemCount: lineageDraft.size,
    items: (report?.items ?? []).filter((it) => it.basis === "aktif").map((it) => {
      const volumeToday = Number(it.volumeDone);
      const base = cumulative.get(it.lineageKey) ?? 0;
      const volumeCumulative = Math.round((counted ? base : base + volumeToday) * 1000) / 1000;
      const volumeContract = it.rabNode.volume != null ? Number(it.rabNode.volume) : null;
      return {
        code: it.rabNode.code,
        name: it.rabNode.name,
        unit: it.rabNode.unit,
        ...kategoriByRoot(it.lineageKey),
        volumeContract,
        volumeBefore: Math.max(0, Math.round((volumeCumulative - volumeToday) * 1000) / 1000),
        volumeToday,
        volumeCumulative,
        // prestasiPct (cap 100) — situs KETIGA rumus ini; dua lainnya sudah
        // dibetulkan DECISIONS 151, yang ini terlewat dan membuat pratinjau/PDF
        // harian menampilkan 110% saat blanko mingguan menulis 100%
        // (audit 2026-07-27, B2).
        pctCumulative:
          volumeContract != null && volumeContract > 0 ? prestasiPct(volumeCumulative, volumeContract) : null,
      };
    }),
    // Pernyataan "tidak ada kegiatan" ikut ke blanko cetak (DECISIONS 396).
    noActivity: report?.noActivity ?? false,
    noActivityReason: report?.noActivityReason ?? null,
    noActivityNote: report?.noActivityNote ?? null,
    isFinal: report?.status === "final",
    ...signatories,
  };
}

/**
 * Baris "Rencana Pekerjaan" blanko harian: ambil rencana MINGGUAN yang memuat
 * tanggal ini, lalu pecah ke hari memakai `rencanaHarian` (urutan tahap +
 * sebaran lonceng). Kosong bila minggu itu belum punya rencana.
 */
async function rencanaHarianUntukTanggal(
  locationId: string,
  reportDate: Date,
): Promise<{ name: string; unit: string | null; volume: number; picName: string | null }[]> {
  const plan = await db.weeklyPlan.findFirst({
    where: { locationId, weekStart: { lte: reportDate }, weekEnd: { gte: reportDate } },
    select: {
      weekStart: true,
      weekEnd: true,
      items: {
        select: {
          targetVolume: true,
          priority: true,
          picName: true,
          rabNode: { select: { name: true, unit: true, amount: true, parentId: true } },
        },
      },
    },
  });
  if (!plan || plan.items.length === 0) return [];

  const hari = Math.floor((reportDate.getTime() - plan.weekStart.getTime()) / 86_400_000) + 1;
  const jumlahHari =
    Math.floor((plan.weekEnd.getTime() - plan.weekStart.getTime()) / 86_400_000) + 1;

  const { rencanaHarian } = await import("@/lib/plan/rencana-harian");
  return rencanaHarian(
    plan.items.map((it) => ({
      name: it.rabNode.name,
      // Kategori dipakai mesin sequencing untuk mendeteksi tipe unit; nama
      // induk tidak selalu tersedia di sini, jadi dipakai nama itemnya sendiri
      // sebagai konteks — klasifikasi tahap tetap jalan dari nama pekerjaan.
      categoryName: it.rabNode.name,
      unit: it.rabNode.unit,
      targetVolume: Number(it.targetVolume),
      amount: it.rabNode.amount,
      picName: it.picName,
      priority: it.priority,
    })),
    jumlahHari,
    hari,
  ).map((r) => ({ name: r.name, unit: r.unit, volume: r.volume, picName: r.picName }));
}

// ─────────────────────────────────────────────────────────────
// Kalender Pelaksanaan Harian (DECISIONS 340)
// ─────────────────────────────────────────────────────────────

/**
 * Isi satu hari yang MEMANG punya laporan. Hari kosong sengaja TIDAK
 * dikembalikan — lapis murni (`kalender-harian.ts`) yang menentukan artinya,
 * karena "kosong" punya tiga arti berbeda dan hanya dia yang tahu masa
 * kontraknya.
 */
export type HariBerlaporan = {
  status: DailyReportStatus;
  itemCount: number;
  fotoCount: number;
};

/** Laporan pada rentang tanggal (inklusif), dipetakan per dateKey. */
export async function getDaysInRange(
  locationId: string,
  startKey: string,
  endKey: string,
): Promise<Map<string, HariBerlaporan>> {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  const out = new Map<string, HariBerlaporan>();
  if (!start || !end || start > end) return out;
  const rows = await db.dailyReport.findMany({
    where: { locationId, reportDate: { gte: start, lte: end } },
    select: {
      reportDate: true,
      status: true,
      _count: { select: { items: true, photos: true } },
    },
  });
  for (const r of rows) {
    out.set(jakartaDateKey(r.reportDate), {
      status: r.status,
      itemCount: r._count.items,
      fotoCount: r._count.photos,
    });
  }
  return out;
}

/**
 * Tanggal laporan paling lama & paling baru di satu lokasi.
 *
 * Dipakai menentukan sejauh mana tombol ‹ › boleh melangkah. Batas yang hanya
 * memakai masa kontrak akan membuat laporan hasil impor yang tanggalnya
 * meleset menjadi mustahil dibuka — dan karena itu mustahil diperbaiki.
 */
export async function getBatasLaporan(
  locationId: string,
): Promise<{ pertama: string | null; terakhir: string | null }> {
  const [awal, akhir] = await Promise.all([
    db.dailyReport.findFirst({
      where: { locationId },
      select: { reportDate: true },
      orderBy: { reportDate: "asc" },
    }),
    db.dailyReport.findFirst({
      where: { locationId },
      select: { reportDate: true },
      orderBy: { reportDate: "desc" },
    }),
  ]);
  return {
    pertama: awal ? jakartaDateKey(awal.reportDate) : null,
    terakhir: akhir ? jakartaDateKey(akhir.reportDate) : null,
  };
}

/** Isi panel "Tanggal Terpilih" — hanya satu tanggal, jadi murah. */
export type DetailHari = {
  status: DailyReportStatus;
  itemCount: number;
  fotoCount: number;
  kendalaTerbuka: number;
  pekerjaCount: number;
  adaCuaca: boolean;
  adaJamKerja: boolean;
  updatedAt: Date;
};

export async function getDetailHari(
  locationId: string,
  dateKey: string,
): Promise<DetailHari | null> {
  const reportDate = parseDateKey(dateKey);
  if (!reportDate) return null;
  const r = await db.dailyReport.findUnique({
    where: { locationId_reportDate: { locationId, reportDate } },
    select: {
      status: true,
      weather: true,
      weatherHourly: true,
      workStart: true,
      workEnd: true,
      updatedAt: true,
      _count: { select: { items: true, photos: true, workers: true } },
      issues: { where: { status: { not: "selesai" }, mergedIntoId: null }, select: { id: true } },
    },
  });
  if (!r) return null;
  return {
    status: r.status,
    itemCount: r._count.items,
    fotoCount: r._count.photos,
    kendalaTerbuka: r.issues.length,
    pekerjaCount: r._count.workers,
    adaCuaca: r.weather !== null || r.weatherHourly !== null,
    // Dua-duanya harus ada: jam mulai tanpa jam selesai bukan jam kerja.
    adaJamKerja: !!r.workStart && !!r.workEnd,
    updatedAt: r.updatedAt,
  };
}
