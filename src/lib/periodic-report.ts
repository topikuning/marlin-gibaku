import "server-only";
import { db } from "@/lib/db";
import { autoCategoryWindowFrac, scheduleFromItems } from "@/lib/scurve/sequencing";
import { orderCategoriesByRab } from "@/lib/scurve/kkp-sheet";
import { COUNTED_REPORT_STATUSES, currentWeekNumber } from "@/lib/progress";
import { bobotPct, distributeWithCaps, itemAchievement, planFractionFromWeekly, prestasiPct } from "@/lib/progress-calc";
import { jakartaDateKey } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";
import type {
  IssueSeverity,
  IssueStatus,
  WeatherCode,
  WorkerRole,
} from "@/generated/prisma/enums";

/**
 * Laporan periodik (mingguan/bulanan) format KKP.
 *
 * FORMULA angka ada di `lib/progress-calc.ts` — SATU sumber yang dipakai
 * laporan ini, kurva-S di halaman yang sama, dan dashboard (DECISIONS 151):
 *   bobot item      = amount / grandTotal × 100   (grandTotal = Σ amount node kategori revisi aktif)
 *   prestasi s/d    = vk > 0 ? min(100, volSd / vk × 100) : 0
 *   prestasi ini    = prestasi s/d − prestasi lalu   ← DITURUNKAN, supaya kolom berjumlah
 *   bobot realisasi = prestasi / 100 × bobot
 *   sisaVol         = max(0, vk − volSd);  sisaPrestasi = max(0, 100 − prestasiSd)
 *   realisasi kurva = Σ bobot realisasi s/d minggu itu (BUKAN Σ valueDone)
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
  /**
   * Harga satuan & harga total kontrak item ini (RAB aktif). Ditambahkan untuk
   * kolom "HARGA SATUAN"/"HARGA TOTAL" pada blanko laporan KKP — kolom yang
   * memang terlihat di berkas resmi, sementara kolom HPS & penawaran di sana
   * disembunyikan (permintaan user 2026-08-06).
   */
  unitPrice: number;
  amount: number;
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
  /**
   * Rencana bobot kumulatif s/d akhir periode (kolom "Bobot Rencana" blanko
   * KKP) = bobot × fraksi rencana KATEGORI-nya (jadwal per kategori; per-item
   * mengikuti proporsional kategorinya).
   */
  bobotRencana: number;
  sisaVol: number;
  sisaPrestasi: number;
};

export type PeriodCategory = {
  /**
   * Identitas kategori = akar `lineageKey` (CALC-04). Nama BISA diganti lewat
   * "ganti judul kategori"; kode romawi bisa bergeser saat kategori disisipkan.
   * Hanya lineageKey yang bertahan, jadi hanya dia yang boleh dipakai menjodohkan
   * kategori dengan jadwal kurva-S tersimpan.
   */
  lineageKey: string;
  code: string;
  name: string;
  rows: PeriodItemRow[];
  /** Σ harga total item — pasangan nilai bagi subtotal bobot. */
  subtotalAmount: number;
  subtotalBobot: number;
  subtotalBobotLalu: number;
  subtotalBobotIni: number;
  subtotalBobotSd: number;
  subtotalBobotRencana: number;
};

export type PeriodHeader = {
  locationName: string;
  village: string;
  district: string | null;
  regency: string;
  province: string;
  packageName: string;
  /**
   * Instansi pemberi tugas (`Package.ownerAgency`, default "KKP") — baris
   * "SATUAN KERJA / PEMBERI TUGAS" pada sampul laporan progres KKP.
   */
  ownerAgency: string;
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
  totals: { bobotLalu: number; bobotIni: number; bobotSd: number; bobotRencana: number };
  planPct: number;
  /**
   * Rencana KUMULATIF s/d akhir periode SEBELUMNYA (0 pada periode pertama).
   * Dipakai sheet REKAP untuk baris "Progres Rencana periode ini" = `planPct −
   * planPrevPct`. Diturunkan di sini supaya selisihnya tidak dihitung ulang di
   * lapisan penyaji (aturan repo: formula angka tidak boleh keluar dari lapisan
   * kalkulasi).
   */
  planPrevPct: number;
  actualPct: number;
  deviationPct: number;
  scurve: { planPct: number[]; actualPct: (number | null)[]; currentWeek: number };
  /** Jadwal per kategori untuk tabel KKP (bobot + jendela minggu) — sumber tunggal. */
  kurvaSchedule: { lineageKey: string; code: string; name: string; weekly: number[] }[];
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

/* ── Kop dokumen: SATU tempat pembentukan ────────────────────────────────── */

/**
 * `select` Prisma untuk kop dokumen KKP, plus pembentuknya.
 *
 * Kop yang sama dipakai laporan periodik DAN formulir rencana mingguan
 * (DECISIONS 258). Dua puluh baris penyalinan field yang identik adalah cara
 * paling mudah membuat dua dokumen resmi menyebut nomor kontrak atau nama PPK
 * yang berbeda tanpa ada yang salah input — jadi bentuknya cuma boleh ada satu.
 */
export const HEADER_LOCATION_SELECT = {
  name: true,
  village: true,
  district: true,
  regency: true,
  province: true,
  package: {
    select: {
      name: true,
      ownerAgency: true,
      contract: {
        select: {
          contractNumber: true,
          contractValue: true,
          workTitle: true,
          durationDays: true,
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
} satisfies Prisma.LocationSelect;

type HeaderLocation = Prisma.LocationGetPayload<{ select: typeof HEADER_LOCATION_SELECT }>;

/**
 * Susun kop dari hasil query `HEADER_LOCATION_SELECT`.
 * null bila kontrak belum ada — dokumen resmi tanpa kontrak tidak boleh terbit.
 */
export function buildPeriodHeader(
  location: HeaderLocation,
  o: { grandTotal: number; startDate: Date; periodeStart: Date; periodeEnd: Date },
): PeriodHeader | null {
  const contract = location.package.contract;
  if (!contract) return null;
  return {
    locationName: location.name,
    village: location.village,
    district: location.district,
    regency: location.regency,
    province: location.province,
    // Nama resmi pekerjaan (workTitle) untuk dokumen; fallback nama pendek paket.
    packageName: contract.workTitle?.trim() || location.package.name,
    ownerAgency: location.package.ownerAgency,
    contractNumber: contract.contractNumber,
    vendorName: contract.vendor.name,
    contractValue: contract.contractValue,
    // Nilai fisik lokasi ini = Σ RAB aktif (bukan nilai kontrak seluruh paket).
    locationValue: BigInt(Math.round(o.grandTotal)),
    masaPelaksanaanHari: Math.max(1, contract.durationDays),
    tahunAnggaran: o.startDate.getUTCFullYear(),
    contractStart: o.startDate,
    periodeStart: o.periodeStart,
    periodeEnd: o.periodeEnd,
    ppkName: contract.ppkName,
    ppkNip: contract.ppkNip,
    supervisorName: contract.supervisorName,
    supervisorFirm: contract.supervisorFirm,
    contractorSignerName: contract.contractorSignerName,
    contractorSignerTitle: contract.contractorSignerTitle,
  };
}

export type PeriodBounds = {
  locationId: string;
  startDate: Date;
  endDate: Date;
  totalWeeks: number;
  totalMonths: number;
  currentWeek: number;
  currentMonth: number;
  /** true = SPMK belum terbit; startDate diasumsikan HARI INI (jadwal/kurva-S saja). */
  assumed: boolean;
};

/**
 * Batas periode valid utk selector & validasi (null bila kontrak belum ada).
 * totalWeeks/totalMonths = jumlah periode dalam masa kontrak (maxN).
 *
 * opts.assume=true: bila SPMK belum terbit (startDate null) TAPI durasi kontrak
 * diketahui, asumsikan mulai HARI INI (saat jadwal diminta) → dipakai Cetak Jadwal
 * /Unduh Excel supaya kurva-S rencana tetap bisa dilihat sebelum SPMK. Laporan
 * periodik REAL tetap panggil tanpa assume (butuh SPMK sungguhan).
 */
export async function getPeriodBounds(
  locationId: string,
  opts?: { assume?: boolean },
): Promise<PeriodBounds | null> {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      package: { select: { contract: { select: { startDate: true, endDate: true, durationDays: true } } } },
    },
  });
  const contract = location?.package.contract;
  if (!contract) return null;

  let startDate: Date;
  let endDate: Date;
  let assumed = false;
  if (contract.startDate && contract.endDate) {
    startDate = contract.startDate;
    endDate = contract.endDate;
  } else if (opts?.assume && contract.durationDays > 0) {
    // SPMK belum terbit → asumsikan mulai hari ini, akhir = mulai + durasi − 1.
    startDate = new Date(`${jakartaDateKey(new Date())}T00:00:00.000Z`);
    endDate = new Date(startDate.getTime() + (contract.durationDays - 1) * DAY);
    assumed = true;
  } else {
    return null;
  }

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
  return { locationId, startDate, endDate, totalWeeks, totalMonths, currentWeek, currentMonth, assumed };
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
  opts?: { assume?: boolean },
): Promise<PeriodReport | null> {
  if (!Number.isInteger(n) || n < 1) return null;

  const location = await db.location.findUnique({
    where: { id: locationId },
    select: HEADER_LOCATION_SELECT,
  });
  if (!location) return null;
  const contract = location.package.contract;
  if (!contract) return null;

  const bounds = await getPeriodBounds(locationId, opts);
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
  // grandTotal = Σ amount kategori (formula kanonik, PROJECT.md + progress.ts).
  // Fallback Σ item hanya untuk RAB tanpa baris kategori. Sentinel `1` yang
  // dulu dipakai saat keduanya nol DIBUANG (audit Codex 2026-07-28, CALC-03):
  // denominator buatan membuat persentase tampak wajar padahal datanya kosong,
  // dan angkanya berbeda dari dashboard yang memakai 0. Nol tetap nol; pembagi
  // nol ditangani sebagai "tidak dapat dihitung" di bawah.
  const grandTotal = sumKategori > 0 ? sumKategori : sumItem;

  // Realisasi terhitung (dikirim/disetujui/final), bucketing by reportDate.
  const itemLineages = new Set(itemNodes.map((nd) => nd.lineageKey));
  const realRows = await db.dailyReportItem.findMany({
    where: {
      // Laporan periodik = dokumen resmi ke KKP ⇒ HANYA basis aktif
      // (DECISIONS 210/211). Filter `itemLineages` di bawah tidak menutup ini:
      // item yang juga ada di draft adendum lolos filter itu dan akan
      // menggerakkan bobot realisasi walau adendumnya belum disetujui.
      basis: "aktif",
      report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } },
    },
    select: {
      lineageKey: true,
      volumeDone: true,
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
        lineageKey: root,
        code: catNode?.code ?? root,
        name: catNode?.name ?? "PEKERJAAN LAIN-LAIN",
        rows: [],
        subtotalAmount: 0,
        subtotalBobot: 0,
        subtotalBobotLalu: 0,
        subtotalBobotIni: 0,
        subtotalBobotSd: 0,
        subtotalBobotRencana: 0,
      };
      catMap.set(root, cat);
    }
    return cat;
  };

  let totalBobotLalu = 0;
  let totalBobotIni = 0;
  let totalBobotSd = 0;
  /** Basis kurva-S: bobot + volume kontrak per item, dipakai ulang di bawah. */
  const curveBasis: { lineageKey: string; volK: number; bobot: number }[] = [];
  for (const it of itemNodes) {
    const cat = catOf(it.lineageKey);
    const bobot = bobotPct(Number(it.amount), grandTotal);
    const vk = Number(it.volume ?? 0);
    const volLalu = lalu.get(it.lineageKey) ?? 0;
    const volIni = ini.get(it.lineageKey) ?? 0;
    const volSd = volLalu + volIni;
    curveBasis.push({ lineageKey: it.lineageKey, volK: vk, bobot });
    // Pembatas 100% hanya di kumulatif; kolom periode diturunkan dgn
    // pengurangan supaya "lalu + ini = s/d" (DECISIONS 151).
    const { prestasiLalu, prestasiIni, prestasiSd, bobotLalu, bobotIni, bobotSd } = itemAchievement({
      volK: vk,
      volLalu,
      volIni,
      bobot,
    });
    totalBobotLalu += bobotLalu;
    totalBobotIni += bobotIni;
    totalBobotSd += bobotSd;
    cat.subtotalAmount += Number(it.amount);
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
      unitPrice: Number(it.unitPrice ?? 0),
      amount: Number(it.amount),
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
      bobotRencana: 0, // diisi setelah jadwal kategori & minggu acuan diketahui (bawah)
      sisaVol: Math.max(0, vk - volSd),
      sisaPrestasi: Math.max(0, 100 - prestasiSd),
    });
  }
  const categories = [...catMap.values()];
  let seq = 0;
  for (const c of categories) for (const row of c.rows) row.no = ++seq;

  // Kurva-S: rencana dari baseline aktif; realisasi kumulatif per minggu dari VOLUME.
  const baseline = await db.baseline.findFirst({
    where: { locationId, status: "aktif" },
    select: {
      points: { select: { weekNumber: true, plannedPct: true }, orderBy: { weekNumber: "asc" } },
      scheduleItems: { select: { lineageKey: true, name: true, weightPct: true, weekly: true } },
    },
  });
  const planSeries = baseline?.points.map((p) => Number(p.plannedPct)) ?? [];

  // Tabel KKP: profil mingguan per-kategori = MATRIKS TERSIMPAN pada baseline
  // (bentuk kanonik, DECISIONS 103) — ikut editan manual & bisa berjeda. Sumber
  // tunggal → sinkron dgn grafik/deviasi. Fallback (matriks belum ada / durasi
  // berubah): turunkan lagi dari jadwal berbasis item + jendela auto.
  // KATEGORI DIJODOHKAN LEWAT `lineageKey`, BUKAN NAMA (CALC-04).
  //
  // Versi lama mencocokkan jadwal tersimpan dengan RAB berdasar NAMA. Nama
  // kategori bisa diganti ("ganti judul kategori", mis. memperbaiki placeholder
  // "PEKERJAAN (kategori VIII — judul tidak ada di file)"), dan begitu diganti,
  // baris jadwalnya kehilangan pasangan: nomor romawinya jadi kosong, judulnya
  // tetap nama lama, dan urutannya terlempar ke belakang daftar. Lebih buruk
  // lagi, kolom "Bobot Rencana" item di kategori itu jatuh ke fallback fraksi
  // rencana LOKASI — jadi angkanya ikut salah, bukan cuma labelnya.
  // (Temuan user 2026-08-06 pada berkas ekspor kurva-S.)
  const catByRootNode = new Map(kategoriNodes.map((nd) => [nd.lineageKey, nd]));
  const catNameByRoot = new Map(kategoriNodes.map((nd) => [nd.lineageKey, nd.name]));
  const storedSched = (baseline?.scheduleItems ?? []).map((s) => ({
    lineageKey: s.lineageKey,
    /** Nama pada baseline = cuplikan saat baseline dibuat; bisa sudah usang. */
    namaTersimpan: s.name,
    weekly: Array.isArray(s.weekly)
      ? (s.weekly as unknown[]).map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0))
      : [],
  }));
  const usableStored =
    storedSched.length > 0 && storedSched.every((s) => s.weekly.length === totalWeeks && s.weekly.some((v) => v > 0));

  let kurvaSchedule: { lineageKey: string; code: string; name: string; weekly: number[] }[];
  if (usableStored) {
    kurvaSchedule = storedSched.map((s) => {
      // Nama & kode SELALU dari RAB aktif — di sanalah judul kategori diubah.
      // Cuplikan pada baseline hanya dipakai bila kategorinya memang sudah
      // tidak ada di revisi aktif (mis. dihapus lewat adendum); kalau begitu
      // kodenya memang kosong, dan itu keadaan yang benar untuk ditampilkan.
      const nd = catByRootNode.get(s.lineageKey);
      return {
        lineageKey: s.lineageKey,
        code: nd?.code ?? "",
        name: nd?.name ?? s.namaTersimpan,
        weekly: s.weekly,
      };
    });
  } else {
    const schedItems = itemNodes
      .filter((nd) => nd.amount > 0n)
      .map((nd) => {
        const root = nd.lineageKey.split("#")[0];
        return { name: nd.name, categoryKey: root, categoryName: catNameByRoot.get(root) ?? "", amount: nd.amount };
      });
    const winFrac = (name: string): [number, number] => autoCategoryWindowFrac(name);
    kurvaSchedule = scheduleFromItems(schedItems, totalWeeks * 7, winFrac).categories.map((c) => ({
      lineageKey: c.categoryKey,
      code: catByRootNode.get(c.categoryKey)?.code ?? "",
      name: c.categoryName,
      weekly: c.weekly,
    }));
  }
  // Kedua sumber di atas datang dalam urutan penyimpanan/penjadwalan, bukan
  // urutan RAB — tanpa ini nomor romawi di tabel KKP meloncat (XIV… lalu I…).
  kurvaSchedule = orderCategoriesByRab(
    kurvaSchedule,
    kategoriNodes.map((nd) => nd.lineageKey),
    (c) => c.lineageKey,
  );
  const seriesLen = Math.max(planSeries.length, totalWeeks);
  const today = new Date(`${jakartaDateKey(new Date())}T00:00:00.000Z`);
  const currentWeek = currentWeekNumber(startDate, seriesLen, today);

  // Realisasi kurva-S dihitung dari VOLUME + bobot revisi aktif — basis yang
  // SAMA persis dengan tabel di atas, bukan dari `valueDone` yang dibekukan
  // memakai harga saat laporan dibuat (DECISIONS 151). Kalau berbeda basis,
  // satu halaman menampilkan dua angka untuk hal yang sama.
  // Hanya item yang PUNYA realisasi yang butuh deret mingguan — RAB bisa ribuan
  // baris sementara yang dilaporkan biasanya puluhan.
  const weeklyVolume = new Map<string, number[]>();
  for (const r of realRows) {
    if (!itemLineages.has(r.lineageKey)) continue;
    const wk = Math.min(
      seriesLen,
      Math.max(1, Math.floor((r.report.reportDate.getTime() - startDate.getTime()) / (7 * DAY)) + 1),
    );
    let arr = weeklyVolume.get(r.lineageKey);
    if (!arr) {
      arr = new Array<number>(seriesLen).fill(0);
      weeklyVolume.set(r.lineageKey, arr);
    }
    arr[wk - 1] += Number(r.volumeDone);
  }
  const basisByLineage = new Map(curveBasis.map((b) => [b.lineageKey, b]));

  // Minggu akhir periode yang diminta (mingguan = n; bulanan = minggu berisi periodeEnd).
  const weekIndex =
    kind === "mingguan"
      ? n
      : Math.min(seriesLen, Math.max(1, Math.floor((periodeEnd.getTime() - startDate.getTime()) / (7 * DAY)) + 1));
  // Realisasi & deviasi kurva-S HANYA terisi s/d akhir periode yang diminta (dan tak
  // melampaui minggu berjalan). Laporan "Minggu ke-n" adalah snapshot s/d minggu n —
  // bukan s/d hari ini — jadi kolom minggu > n tidak diisi realisasi/deviasi.
  const cutoffWeek = Math.min(currentWeek, Math.max(1, weekIndex));

  // Akumulasi per item sekali jalan (item × minggu, tanpa alokasi per minggu):
  // tiap minggu ditambah prestasi KUMULATIF item itu s/d minggu tsb × bobotnya —
  // pembatas 100% ikut terpasang, persis seperti kolom "bobot s/d" di tabel.
  const actualTotals = new Array<number>(seriesLen).fill(0);
  for (const [lineageKey, arr] of weeklyVolume) {
    const b = basisByLineage.get(lineageKey);
    if (!b) continue;
    let cum = 0;
    for (let w = 0; w < seriesLen; w++) {
      cum += arr[w];
      actualTotals[w] += (prestasiPct(cum, b.volK) / 100) * b.bobot;
    }
  }
  const actualSeries: (number | null)[] = actualTotals.map((v, i) => (i + 1 <= cutoffWeek ? v : null));

  const planIdx = Math.min(Math.max(planSeries.length, 1), Math.max(1, weekIndex)) - 1;
  const planPct = planSeries[planIdx] ?? 0;
  // Rencana kumulatif s/d akhir periode SEBELUMNYA. Minggu acuannya = minggu
  // yang memuat hari terakhir sebelum periode ini dimulai; periode pertama
  // tidak punya pendahulu ⇒ 0 (bukan planSeries[0] — itu akan membuat "rencana
  // minggu ini" pada minggu-1 tertulis nol padahal ada rencananya).
  const prevWeekIndex =
    kind === "mingguan"
      ? n - 1
      : Math.floor((periodeStart.getTime() - DAY - startDate.getTime()) / (7 * DAY)) + 1;
  const planPrevPct =
    prevWeekIndex < 1
      ? 0
      : (planSeries[Math.min(Math.max(planSeries.length, 1), prevWeekIndex) - 1] ?? 0);
  // Angka realisasi laporan = total kolom "bobot s/d" tabel. Satu perhitungan,
  // satu angka — tabel, kurva, dan deviasi tidak mungkin lagi berselisih.
  const actualPct = totalBobotSd;

  // Kolom "Bobot Rencana" blanko KKP: rencana bobot kumulatif s/d akhir periode
  // per item = bobot × fraksi rencana KATEGORI-nya (jadwal disimpan per
  // kategori — DECISIONS 103; per-item mengikuti proporsional kategorinya).
  // Kategori tanpa jadwal → fallback fraksi rencana lokasi (planPct/100).
  //
  // REKONSILIASI: kurva RESMI = titik baseline (B3), yang boleh berbeda tipis
  // dari Σ matriks kategori (mis. setelah edit manual titik). Supaya SATU
  // dokumen tidak menampilkan dua angka rencana, seluruh kolom diskalakan
  // sehingga JUMLAH "Bobot Rencana" == planPct resmi; bentuk antar-kategori
  // tetap mengikuti matriks. Per item di-clamp ke bobotnya.
  const planWeek = Math.max(1, Math.min(seriesLen, weekIndex));
  // Dijodohkan lewat lineageKey — lihat catatan di atas. Pencocokan by-name
  // membuat kategori yang judulnya pernah diganti kehilangan jadwalnya dan
  // memakai fraksi rencana lokasi, sehingga "Bobot Rencana"-nya salah diam-diam.
  const weeklyByCatKey = new Map(kurvaSchedule.map((s) => [s.lineageKey, s.weekly]));
  const locPlanFrac = Math.min(1, Math.max(0, planPct / 100));
  const flatRows = categories.flatMap((cat) => cat.rows.map((row) => ({ cat, row })));
  const rawWeights = flatRows.map(({ cat, row }) => {
    const weekly = weeklyByCatKey.get(cat.lineageKey);
    const frac = weekly ? planFractionFromWeekly(weekly, planWeek) : locPlanFrac;
    return row.bobot * frac;
  });
  const distributed = distributeWithCaps(
    rawWeights,
    flatRows.map(({ row }) => row.bobot),
    planPct,
  );
  let totalBobotRencana = 0;
  flatRows.forEach(({ cat, row }, i) => {
    row.bobotRencana = distributed[i];
    cat.subtotalBobotRencana += distributed[i];
    totalBobotRencana += distributed[i];
  });

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

  const header = buildPeriodHeader(location, { grandTotal, startDate, periodeStart, periodeEnd });
  if (!header) return null;

  return {
    kind,
    n,
    maxN,
    totalWeeks,
    totalMonths,
    header,
    categories,
    totals: { bobotLalu: totalBobotLalu, bobotIni: totalBobotIni, bobotSd: totalBobotSd, bobotRencana: totalBobotRencana },
    planPct,
    planPrevPct,
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
