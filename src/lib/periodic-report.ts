import "server-only";
import { db } from "@/lib/db";
import { autoCategorySchedule } from "@/lib/scurve/generate";
import { COUNTED_REPORT_STATUSES, currentWeekNumber } from "@/lib/progress";
import { jakartaDateKey } from "@/lib/format";
import type {
  IssueSeverity,
  IssueStatus,
  WeatherCode,
  WorkerRole,
} from "@/generated/prisma/enums";

/**
 * Laporan periodik (mingguan/bulanan) format KKP.
 * FORMULA bobot/prestasi dipertahankan PERSIS dari implementasi lama (b6e77af):
 *   bobot item      = amount / grandTotal × 100   (grandTotal = Σ amount node kategori revisi aktif)
 *   prestasi        = vk > 0 ? min(100, vol / vk × 100) : 0
 *   bobot realisasi = prestasi / 100 × bobot
 *   sisaVol         = max(0, vk − volSd);  sisaPrestasi = max(0, 100 − prestasiSd)
 * Adaptasi ke schema baru:
 *   item      = DailyReportItem dengan report.status ∈ (dikirim, disetujui, final)
 *   bucketing = report.reportDate (sudah tanggal kerja, date-only)
 *   vk/harga  = RabNode revisi AKTIF by lineageKey
 * Periode:
 *   mingguan ke-n = [startDate + (n−1)×7 hari, +6 hari]
 *   bulanan  ke-n = bulan kalender ke-n sejak startDate
 */

export type PeriodKind = "mingguan" | "bulanan";

export type PeriodItemRow = {
  no: number;
  code: string;
  name: string;
  volK: number;
  unit: string;
  hargaSatuan: number;
  bobot: number;
  volLalu: number;
  prestasiLalu: number;
  bobotLalu: number;
  volIni: number;
  prestasiIni: number;
  bobotIni: number;
  volSd: number;
  prestasiSd: number;
  bobotSd: number;
  sisaVol: number;
  sisaPrestasi: number;
};

export type PeriodCategory = {
  code: string;
  name: string;
  rows: PeriodItemRow[];
  subtotalBobot: number;
  subtotalBobotLalu: number;
  subtotalBobotIni: number;
  subtotalBobotSd: number;
};

export type PeriodHeader = {
  locationName: string;
  village: string;
  district: string | null;
  regency: string;
  province: string;
  packageName: string;
  contractNumber: string;
  vendorName: string;
  /** Nilai kontrak paket (seluruh lokasi) — dipakai bila perlu konteks paket. */
  contractValue: bigint;
  /** Nilai fisik LOKASI ini (Σ RAB aktif) — dipakai di header laporan per-lokasi. */
  locationValue: bigint;
  masaPelaksanaanHari: number;
  tahunAnggaran: number;
  /** Tanggal mulai kontrak — utk kolom kurva-S dikelompokkan per bulan. */
  contractStart: Date;
  periodeStart: Date;
  periodeEnd: Date;
  /** Penanda tangan dokumen KKP (null = blok TTD dikosongkan). */
  ppkName: string | null;
  ppkNip: string | null;
  supervisorName: string | null;
  supervisorFirm: string | null;
  contractorSignerName: string | null;
  contractorSignerTitle: string | null;
};

export type PeriodReport = {
  kind: PeriodKind;
  n: number;
  maxN: number;
  totalWeeks: number;
  totalMonths: number;
  header: PeriodHeader;
  categories: PeriodCategory[];
  totals: { bobotLalu: number; bobotIni: number; bobotSd: number };
  planPct: number;
  actualPct: number;
  deviationPct: number;
  scurve: { planPct: number[]; actualPct: (number | null)[]; currentWeek: number };
  /** Jadwal per kategori untuk tabel KKP (bobot + jendela minggu) — sumber tunggal. */
  kurvaSchedule: { code: string; name: string; weightPct: number; startWeek: number; endWeek: number }[];
  tenaga: { role: WorkerRole; label: string; count: number }[];
  material: { name: string; unit: string | null; qty: number }[];
  alat: { name: string; count: number }[];
  cuacaRingkas: string;
  kendala: { title: string; severity: IssueSeverity; status: IssueStatus; createdAt: Date }[];
};

export const WORKER_ROLE_LABEL: Record<WorkerRole, string> = {
  site_manager: "Site Manager",
  pelaksana: "Pelaksana",
  mandor: "Mandor",
  kepala_tukang: "Kepala Tukang",
  tukang_bongkar: "Tukang Bongkar",
  tukang_batu: "Tukang Batu",
  tukang_besi: "Tukang Besi",
  tukang_kayu: "Tukang Kayu",
  tukang_pipa: "Tukang Pipa",
  tukang_listrik: "Tukang Listrik",
  tukang_cat: "Tukang Cat",
  tenaga: "Tenaga",
  logistik: "Logistik",
  operator: "Operator",
};

const WEATHER_LABEL: Record<WeatherCode, string> = {
  cerah: "Cerah",
  berawan: "Berawan",
  hujan_ringan: "Hujan Ringan",
  hujan_deras: "Hujan Deras",
  angin_kencang: "Angin Kencang",
  banjir: "Banjir",
};

const DAY = 24 * 3600 * 1000;

/** Tambah bulan kalender (UTC, kolom @db.Date) — formula lama dipertahankan. */
function addMonths(base: Date, months: number): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()));
}

/** Kunci tanggal date-only (@db.Date tersimpan UTC-midnight). */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type PeriodBounds = {
  locationId: string;
  startDate: Date;
  endDate: Date;
  totalWeeks: number;
  totalMonths: number;
  currentWeek: number;
  currentMonth: number;
};

/**
 * Batas periode valid utk selector & validasi (null bila kontrak belum ada).
 * totalWeeks/totalMonths = jumlah periode dalam masa kontrak (maxN).
 */
export async function getPeriodBounds(locationId: string): Promise<PeriodBounds | null> {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { id: true, package: { select: { contract: { select: { startDate: true, endDate: true } } } } },
  });
  const contract = location?.package.contract;
  // Butuh SPMK (startDate) & endDate — jadwal periodik baru aktif setelah SPMK terbit.
  if (!contract || !contract.startDate || !contract.endDate) return null;
  const startDate = contract.startDate;
  const endDate = contract.endDate;
  const totalWeeks = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime() + DAY) / (7 * DAY)));
  const totalMonths = Math.max(
    1,
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      (endDate.getUTCMonth() - startDate.getUTCMonth()) +
      1,
  );
  const now = new Date(`${jakartaDateKey(new Date())}T00:00:00.000Z`);
  const currentWeek = currentWeekNumber(startDate, totalWeeks, now);
  const monthsElapsed = Math.floor(
    (now.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (now.getUTCMonth() - startDate.getUTCMonth()),
  );
  const currentMonth = Math.max(1, Math.min(totalMonths, monthsElapsed + 1));
  return { locationId, startDate, endDate, totalWeeks, totalMonths, currentWeek, currentMonth };
}

/**
 * Susun laporan periodik. null bila prasyarat belum ada
 * (lokasi/kontrak/RAB aktif) atau n di luar [1, maxN].
 * Otorisasi TIDAK di sini — caller wajib requireUser + scope lokasi.
 */
export async function getPeriodReport(
  locationId: string,
  kind: PeriodKind,
  n: number,
): Promise<PeriodReport | null> {
  if (!Number.isInteger(n) || n < 1) return null;

  const location = await db.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      village: true,
      district: true,
      regency: true,
      province: true,
      package: {
        select: {
          name: true,
          contract: {
            select: {
              contractNumber: true,
              contractValue: true,
              workTitle: true,
              durationDays: true,
              startDate: true,
              endDate: true,
              ppkName: true,
              ppkNip: true,
              supervisorName: true,
              supervisorFirm: true,
              contractorSignerName: true,
              contractorSignerTitle: true,
              vendor: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!location) return null;
  const contract = location.package.contract;
  if (!contract) return null;

  const bounds = await getPeriodBounds(locationId);
  if (!bounds) return null;
  const { startDate, totalWeeks, totalMonths } = bounds;
  const maxN = kind === "mingguan" ? totalWeeks : totalMonths;
  if (n > maxN) return null;

  // Periode ke-n (date-only, UTC-midnight seperti kolom @db.Date).
  let periodeStart: Date;
  let periodeEnd: Date;
  if (kind === "mingguan") {
    periodeStart = new Date(startDate.getTime() + (n - 1) * 7 * DAY);
    periodeEnd = new Date(periodeStart.getTime() + 6 * DAY);
  } else {
    periodeStart = addMonths(startDate, n - 1);
    periodeEnd = new Date(addMonths(startDate, n).getTime() - DAY);
  }
  const sKey = dateKey(periodeStart);
  const eKey = dateKey(periodeEnd);

  // RAB revisi aktif: kategori (bobot basis) + item (vk, harga, lineage).
  const revision = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  if (!revision) return null;
  const nodes = await db.rabNode.findMany({
    where: { revisionId: revision.id, kind: { in: ["kategori", "item"] } },
    orderBy: { sortOrder: "asc" },
    select: {
      kind: true,
      code: true,
      name: true,
      volume: true,
      unit: true,
      unitPrice: true,
      amount: true,
      lineageKey: true,
    },
  });
  const kategoriNodes = nodes.filter((nd) => nd.kind === "kategori");
  const itemNodes = nodes.filter((nd) => nd.kind === "item");
  const sumKategori = kategoriNodes.reduce((s, nd) => s + Number(nd.amount), 0);
  const sumItem = itemNodes.reduce((s, nd) => s + Number(nd.amount), 0);
  // grandTotal = Σ amount kategori (fallback Σ item bila RAB tanpa kategori).
  const grandTotal = sumKategori > 0 ? sumKategori : sumItem > 0 ? sumItem : 1;

  // Realisasi terhitung (dikirim/disetujui/final), bucketing by reportDate.
  const itemLineages = new Set(itemNodes.map((nd) => nd.lineageKey));
  const realRows = await db.dailyReportItem.findMany({
    where: { report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } } },
    select: {
      lineageKey: true,
      volumeDone: true,
      valueDone: true,
      report: { select: { reportDate: true } },
    },
  });
  const lalu = new Map<string, number>();
  const ini = new Map<string, number>();
  for (const r of realRows) {
    if (!itemLineages.has(r.lineageKey)) continue; // lineage revisi lama yang hilang di revisi aktif
    const k = dateKey(r.report.reportDate);
    const v = Number(r.volumeDone);
    if (k < sKey) lalu.set(r.lineageKey, (lalu.get(r.lineageKey) ?? 0) + v);
    else if (k <= eKey) ini.set(r.lineageKey, (ini.get(r.lineageKey) ?? 0) + v);
  }

  // Susun kategori → item. Kategori item = segmen pertama lineageKey ("I#6.1#a" → "I").
  const catByRoot = new Map(kategoriNodes.map((nd) => [nd.lineageKey, nd]));
  const catMap = new Map<string, PeriodCategory>();
  const catOf = (lineageKey: string): PeriodCategory => {
    const root = lineageKey.split("#")[0];
    let cat = catMap.get(root);
    if (!cat) {
      const catNode = catByRoot.get(root);
      cat = {
        code: catNode?.code ?? root,
        name: catNode?.name ?? "PEKERJAAN LAIN-LAIN",
        rows: [],
        subtotalBobot: 0,
        subtotalBobotLalu: 0,
        subtotalBobotIni: 0,
        subtotalBobotSd: 0,
      };
      catMap.set(root, cat);
    }
    return cat;
  };

  let totalBobotLalu = 0;
  let totalBobotIni = 0;
  let totalBobotSd = 0;
  for (const it of itemNodes) {
    const cat = catOf(it.lineageKey);
    const bobot = (Number(it.amount) / grandTotal) * 100;
    const vk = Number(it.volume ?? 0);
    const volLalu = lalu.get(it.lineageKey) ?? 0;
    const volIni = ini.get(it.lineageKey) ?? 0;
    const volSd = volLalu + volIni;
    const prestasi = (v: number) => (vk > 0 ? Math.min(100, (v / vk) * 100) : 0);
    const prestasiLalu = prestasi(volLalu);
    const prestasiIni = prestasi(volIni);
    const prestasiSd = prestasi(volSd);
    const bobotLalu = (prestasiLalu / 100) * bobot;
    const bobotIni = (prestasiIni / 100) * bobot;
    const bobotSd = (prestasiSd / 100) * bobot;
    totalBobotLalu += bobotLalu;
    totalBobotIni += bobotIni;
    totalBobotSd += bobotSd;
    cat.subtotalBobot += bobot;
    cat.subtotalBobotLalu += bobotLalu;
    cat.subtotalBobotIni += bobotIni;
    cat.subtotalBobotSd += bobotSd;
    cat.rows.push({
      no: 0,
      code: it.code,
      name: it.name,
      volK: vk,
      unit: it.unit ?? "",
      hargaSatuan: Number(it.unitPrice ?? 0),
      bobot,
      volLalu,
      prestasiLalu,
      bobotLalu,
      volIni,
      prestasiIni,
      bobotIni,
      volSd,
      prestasiSd,
      bobotSd,
      sisaVol: Math.max(0, vk - volSd),
      sisaPrestasi: Math.max(0, 100 - prestasiSd),
    });
  }
  const categories = [...catMap.values()];
  let seq = 0;
  for (const c of categories) for (const row of c.rows) row.no = ++seq;

  // Kurva-S: rencana dari baseline aktif; realisasi kumulatif per minggu dari valueDone.
  const baseline = await db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    select: {
      points: { select: { weekNumber: true, plannedPct: true }, orderBy: { weekNumber: "asc" } },
      scheduleItems: { select: { lineageKey: true, name: true, weightPct: true, startWeek: true, endWeek: true } },
    },
  });
  const planSeries = baseline?.points.map((p) => Number(p.plannedPct)) ?? [];

  // Jadwal per-kategori untuk tabel KKP — dari baseline TERSIMPAN (ikut edit
  // manual); fallback auto (presedensi kategori) bila baseline lama tak simpan.
  // DECISIONS 079: sumber tunggal → tabel KKP sinkron dgn grafik & deviasi.
  const codeByKey = new Map(kategoriNodes.map((nd) => [nd.lineageKey, nd.code ?? ""]));
  const storedSchedule = baseline?.scheduleItems ?? [];
  const kurvaSchedule =
    storedSchedule.length > 0
      ? storedSchedule.map((s) => ({
          code: codeByKey.get(s.lineageKey) ?? "",
          name: s.name,
          weightPct: Number(s.weightPct),
          startWeek: s.startWeek,
          endWeek: s.endWeek,
        }))
      : autoCategorySchedule(
          kategoriNodes.map((nd) => ({ lineageKey: nd.lineageKey, name: nd.name, amount: nd.amount })),
          totalWeeks,
        ).map((s) => ({
          code: codeByKey.get(s.lineageKey) ?? "",
          name: s.name,
          weightPct: s.weightPct,
          startWeek: s.startWeek,
          endWeek: s.endWeek,
        }));
  const seriesLen = Math.max(planSeries.length, totalWeeks);
  const today = new Date(`${jakartaDateKey(new Date())}T00:00:00.000Z`);
  const currentWeek = currentWeekNumber(startDate, seriesLen, today);
  const weeklyValue = new Array<number>(seriesLen).fill(0);
  let valueSdPeriode = 0;
  for (const r of realRows) {
    if (!itemLineages.has(r.lineageKey)) continue;
    const wk = Math.min(
      seriesLen,
      Math.max(1, Math.floor((r.report.reportDate.getTime() - startDate.getTime()) / (7 * DAY)) + 1),
    );
    weeklyValue[wk - 1] += Number(r.valueDone);
    if (dateKey(r.report.reportDate) <= eKey) valueSdPeriode += Number(r.valueDone);
  }

  // Minggu akhir periode yang diminta (mingguan = n; bulanan = minggu berisi periodeEnd).
  const weekIndex =
    kind === "mingguan"
      ? n
      : Math.min(seriesLen, Math.max(1, Math.floor((periodeEnd.getTime() - startDate.getTime()) / (7 * DAY)) + 1));
  // Realisasi & deviasi kurva-S HANYA terisi s/d akhir periode yang diminta (dan tak
  // melampaui minggu berjalan). Laporan "Minggu ke-n" adalah snapshot s/d minggu n —
  // bukan s/d hari ini — jadi kolom minggu > n tidak diisi realisasi/deviasi.
  const cutoffWeek = Math.min(currentWeek, Math.max(1, weekIndex));

  const actualSeries: (number | null)[] = [];
  let cum = 0;
  for (let w = 1; w <= seriesLen; w++) {
    cum += weeklyValue[w - 1];
    actualSeries.push(w <= cutoffWeek ? (cum / grandTotal) * 100 : null);
  }

  const planIdx = Math.min(Math.max(planSeries.length, 1), Math.max(1, weekIndex)) - 1;
  const planPct = planSeries[planIdx] ?? 0;
  const actualPct = (valueSdPeriode / grandTotal) * 100;

  // Agregat tenaga/material/alat + cuaca dari laporan harian dalam periode.
  const periodReports = await db.dailyReport.findMany({
    where: {
      locationId,
      status: { in: [...COUNTED_REPORT_STATUSES] },
      reportDate: { gte: periodeStart, lte: periodeEnd },
    },
    select: {
      weather: true,
      workers: { select: { role: true, count: true } },
      materials: { select: { name: true, unit: true, qtyReceived: true } },
      equipment: { select: { name: true, count: true } },
    },
  });
  const tenagaMap = new Map<WorkerRole, number>();
  const materialMap = new Map<string, { name: string; unit: string | null; qty: number }>();
  const alatMap = new Map<string, number>();
  const weatherCount = new Map<WeatherCode, number>();
  for (const rep of periodReports) {
    if (rep.weather) weatherCount.set(rep.weather, (weatherCount.get(rep.weather) ?? 0) + 1);
    for (const w of rep.workers) tenagaMap.set(w.role, (tenagaMap.get(w.role) ?? 0) + w.count);
    for (const m of rep.materials) {
      const key = `${m.name}||${m.unit ?? ""}`;
      const cur = materialMap.get(key) ?? { name: m.name, unit: m.unit, qty: 0 };
      cur.qty += Number(m.qtyReceived ?? 0);
      materialMap.set(key, cur);
    }
    for (const e of rep.equipment) alatMap.set(e.name, (alatMap.get(e.name) ?? 0) + e.count);
  }
  const cuacaRingkas =
    [...weatherCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => `${WEATHER_LABEL[code]} ${count} hari`)
      .join(" · ") || "—";

  // Kendala (Issue) yang muncul pada periode — hari kerja dihitung di Asia/Jakarta,
  // jadi query dilebihkan 1 hari lalu difilter presisi dengan jakartaDateKey.
  const issuesRaw = await db.issue.findMany({
    where: {
      locationId,
      createdAt: {
        gte: new Date(periodeStart.getTime() - DAY),
        lt: new Date(periodeEnd.getTime() + 2 * DAY),
      },
    },
    orderBy: { createdAt: "asc" },
    select: { title: true, severity: true, status: true, createdAt: true },
  });
  const issues = issuesRaw.filter((i) => {
    const k = jakartaDateKey(i.createdAt);
    return k >= sKey && k <= eKey;
  });

  const masaPelaksanaanHari = Math.max(1, contract.durationDays);

  return {
    kind,
    n,
    maxN,
    totalWeeks,
    totalMonths,
    header: {
      locationName: location.name,
      village: location.village,
      district: location.district,
      regency: location.regency,
      province: location.province,
      // Nama resmi pekerjaan (workTitle) untuk dokumen; fallback nama pendek paket.
      packageName: contract.workTitle?.trim() || location.package.name,
      contractNumber: contract.contractNumber,
      vendorName: contract.vendor.name,
      contractValue: contract.contractValue,
      // Nilai fisik lokasi ini = Σ RAB aktif (bukan nilai kontrak seluruh paket).
      locationValue: BigInt(Math.round(grandTotal)),
      masaPelaksanaanHari,
      tahunAnggaran: startDate.getUTCFullYear(),
      contractStart: startDate,
      periodeStart,
      periodeEnd,
      ppkName: contract.ppkName,
      ppkNip: contract.ppkNip,
      supervisorName: contract.supervisorName,
      supervisorFirm: contract.supervisorFirm,
      contractorSignerName: contract.contractorSignerName,
      contractorSignerTitle: contract.contractorSignerTitle,
    },
    categories,
    totals: { bobotLalu: totalBobotLalu, bobotIni: totalBobotIni, bobotSd: totalBobotSd },
    planPct,
    actualPct,
    deviationPct: actualPct - planPct,
    scurve: { planPct: planSeries, actualPct: actualSeries, currentWeek: cutoffWeek },
    kurvaSchedule,
    tenaga: [...tenagaMap.entries()].map(([role, count]) => ({
      role,
      label: WORKER_ROLE_LABEL[role],
      count,
    })),
    material: [...materialMap.values()],
    alat: [...alatMap.entries()].map(([name, count]) => ({ name, count })),
    cuacaRingkas,
    kendala: issues,
  };
}
