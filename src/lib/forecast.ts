import type { ScurveSeries } from "@/lib/baseline";

/**
 * Mesin PROGNOSA (forecast) jadwal/fisik — MURNI & deterministik (tanpa I/O),
 * bekerja pada kurva-S tertimbang-uang yang sudah ada. Melengkapi siklus
 * Rencana → Aktual → Prognosa. Tak menyimpan kolom agregat apa pun (prinsip #4:
 * angka agregat selalu derived). DECISIONS 132.
 *
 * Dua metode (best-practice EVM dimensi jadwal):
 *  - LAJU TERKINI (run-rate): kecepatan realisasi N minggu terakhir → sisa waktu.
 *  - SPI (kinerja kumulatif): SPI = aktual% / rencana%; durasi prognosa = totalWeeks / SPI.
 * Utama = laju terkini (momentum); bila laju terhenti/tak cukup data → SPI.
 * Metode lain jadi PEMBANDING (rentang optimis–pesimis).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RUNRATE_WINDOW = 4; // minggu terakhir untuk laju terkini
const MIN_ACTUAL_POINTS = 2; // minimal titik realisasi agar laju bermakna
const DONE_PCT = 99.95; // dianggap selesai
/**
 * PEREDAM horizon (audit UI 2026-07-27): laju/SPI mendekati nol membuat minggu
 * selesai melesat absurd ("16 Apr 2086, telat ~3115 mgg") — itu artefak
 * pembagian dgn bilangan kecil, bukan informasi. Prognosa yang jatuh lebih dari
 * setahun melewati akhir kontrak tidak ditampilkan sebagai tanggal/selisih;
 * status tetap "telat".
 */
const HORIZON_EXTRA_WEEKS = 52;

export type ForecastStatus = "aman" | "waspada" | "telat" | "belum_mulai" | "selesai" | "data_kurang";

export type LocationForecast = {
  enoughData: boolean;
  status: ForecastStatus;
  method: "laju" | "spi" | null;

  currentWeek: number;
  totalWeeks: number;
  actualPct: number; // A — realisasi kumulatif di titik terakhir
  planPct: number; // P — rencana di minggu yang sama
  deviationPct: number; // A − P

  velocityPerWeek: number | null; // laju terkini (%/minggu)
  spi: number | null; // A / P
  requiredPerWeek: number | null; // laju dibutuhkan agar selesai tepat waktu

  forecastFinishWeek: number | null; // minggu selesai fisik (bisa pecahan)
  forecastFinishDate: Date | null;
  /** Prognosa jatuh > horizon (akhir kontrak + 52 mgg) — tanggal/selisih diredam. */
  beyondHorizon: boolean;
  slipWeeks: number | null; // finishWeek − totalWeeks (bulat; ≤0 = tepat/awal)
  projectedPctAtEnd: number | null; // prognosa % saat akhir kontrak

  altFinishWeek: number | null; // metode pembanding (rentang)
  altFinishDate: Date | null;

  forecastPct: (number | null)[]; // garis prognosa untuk chart (panjang totalWeeks)
};

/** Tambah `days` (boleh pecahan) ke tanggal UTC-midnight (@db.Date). */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + Math.round(days) * DAY_MS);
}
/** Tanggal akhir "minggu ke-f" ≈ startDate + f×7 − 1 hari (selaras endDate = start + N×7 − 1). */
function weekToDate(startDate: Date, week: number): Date {
  return addDays(startDate, week * 7 - 1);
}
const clampPct = (v: number) => Math.max(0, Math.min(100, v));

export type ForecastOpts = { runRateWindow?: number };

/**
 * Hitung prognosa dari kurva-S + tanggal mulai. Jika `startDate` null (SPMK belum
 * terbit) tanggal tak dihitung, tapi minggu & status tetap.
 */
export function forecastFromSeries(
  series: Pick<ScurveSeries, "totalWeeks" | "currentWeek" | "planPct" | "actualPct">,
  startDate: Date | null,
  opts: ForecastOpts = {},
): LocationForecast {
  const N = series.totalWeeks;
  const w = Math.max(1, series.currentWeek);
  const window = Math.max(1, opts.runRateWindow ?? RUNRATE_WINDOW);
  const plan = series.planPct;
  const actual = series.actualPct;

  const empty = (status: ForecastStatus): LocationForecast => ({
    enoughData: false,
    status,
    method: null,
    currentWeek: w,
    totalWeeks: N,
    actualPct: 0,
    planPct: 0,
    deviationPct: 0,
    velocityPerWeek: null,
    spi: null,
    requiredPerWeek: null,
    forecastFinishWeek: null,
    forecastFinishDate: null,
    beyondHorizon: false,
    slipWeeks: null,
    projectedPctAtEnd: null,
    altFinishWeek: null,
    altFinishDate: null,
    forecastPct: new Array(Math.max(0, N)).fill(null),
  });

  if (N <= 0) return empty("data_kurang");

  // Titik realisasi non-null hingga minggu berjalan.
  const pts: { week: number; val: number }[] = [];
  for (let i = 0; i < Math.min(actual.length, w); i++) {
    const v = actual[i];
    if (v != null) pts.push({ week: i + 1, val: v });
  }
  if (pts.length === 0) return empty("belum_mulai");

  const last = pts[pts.length - 1];
  const A = last.val;
  const wA = last.week;
  const P = plan.length ? plan[Math.min(plan.length - 1, wA - 1)] ?? 0 : 0;
  const deviationPct = A - P;

  const forecastPct: (number | null)[] = new Array(N).fill(null);
  const requiredPerWeek = N > wA ? clampPct(100 - A) / (N - wA) : null;

  // Sudah selesai fisik.
  if (A >= DONE_PCT) {
    for (let i = 0; i < N; i++) forecastPct[i] = i + 1 >= wA ? 100 : null;
    return {
      enoughData: true,
      status: "selesai",
      method: null,
      currentWeek: w,
      totalWeeks: N,
      actualPct: A,
      planPct: P,
      deviationPct,
      velocityPerWeek: null,
      spi: P > 0 ? A / P : null,
      requiredPerWeek: 0,
      forecastFinishWeek: wA,
      forecastFinishDate: startDate ? weekToDate(startDate, wA) : null,
      beyondHorizon: false,
      slipWeeks: Math.round(wA - N),
      projectedPctAtEnd: 100,
      altFinishWeek: null,
      altFinishDate: null,
      forecastPct,
    };
  }

  const enoughData = pts.length >= MIN_ACTUAL_POINTS;

  // Laju terkini (run-rate) atas jendela minggu terakhir.
  const firstInWin = pts.find((p) => p.week >= wA - window) ?? pts[0];
  const spanW = wA - firstInWin.week;
  const velocityPerWeek = spanW > 0 ? (A - firstInWin.val) / spanW : null;

  // SPI kumulatif.
  const spi = P > 0 ? A / P : null;

  if (!enoughData) return { ...empty("data_kurang"), currentWeek: w, totalWeeks: N, actualPct: A, planPct: P, deviationPct, spi, requiredPerWeek, forecastPct };

  // Minggu selesai per metode.
  const finishRunRate = velocityPerWeek && velocityPerWeek > 0 ? wA + (100 - A) / velocityPerWeek : null;
  const finishSpi = spi && spi > 0 ? N / spi : null;

  // Utama = laju terkini bila valid, jika tidak SPI.
  let method: "laju" | "spi" | null = null;
  let finishWeek: number | null = null;
  let altFinishWeek: number | null = null;
  if (finishRunRate != null) {
    method = "laju";
    finishWeek = finishRunRate;
    altFinishWeek = finishSpi;
  } else if (finishSpi != null) {
    method = "spi";
    finishWeek = finishSpi;
    altFinishWeek = null;
  }

  // Kemiringan garis prognosa utama (menuju 100% di finishWeek).
  const slope = finishWeek != null && finishWeek > wA ? (100 - A) / (finishWeek - wA) : 0;
  for (let i = 0; i < N; i++) {
    const wk = i + 1;
    if (wk < wA) continue;
    if (wk === wA) {
      forecastPct[i] = A;
      continue;
    }
    forecastPct[i] = clampPct(A + slope * (wk - wA));
  }

  const projectedPctAtEnd = finishWeek != null ? (finishWeek <= N ? 100 : clampPct(A + slope * (N - wA))) : A;
  const slipWeeks = finishWeek != null ? Math.round(finishWeek - N) : null;

  let status: ForecastStatus;
  if (finishWeek == null) {
    status = "telat"; // realisasi terhenti & SPI tak bisa dihitung
  } else if (slipWeeks != null && slipWeeks <= 0) {
    status = "aman";
  } else {
    const waspadaMax = Math.max(2, Math.ceil(N * 0.05));
    status = (slipWeeks ?? 0) <= waspadaMax ? "waspada" : "telat";
  }

  // Peredam horizon — status dihitung DULU dari angka mentah (pasti "telat"),
  // baru tanggal/minggu/selisih yang absurd disembunyikan dari output.
  const horizonWeek = N + HORIZON_EXTRA_WEEKS;
  const beyondHorizon = finishWeek != null && finishWeek > horizonWeek;
  if (beyondHorizon) finishWeek = null;
  if (altFinishWeek != null && altFinishWeek > horizonWeek) altFinishWeek = null;
  const dampedSlip = beyondHorizon ? null : slipWeeks;

  return {
    enoughData: true,
    status,
    method,
    currentWeek: w,
    totalWeeks: N,
    actualPct: A,
    planPct: P,
    deviationPct,
    velocityPerWeek,
    spi,
    requiredPerWeek,
    forecastFinishWeek: finishWeek,
    forecastFinishDate: startDate && finishWeek != null ? weekToDate(startDate, finishWeek) : null,
    beyondHorizon,
    slipWeeks: dampedSlip,
    projectedPctAtEnd,
    altFinishWeek,
    altFinishDate: startDate && altFinishWeek != null ? weekToDate(startDate, altFinishWeek) : null,
    forecastPct,
  };
}

/** Label + nada status prognosa untuk UI. */
export const FORECAST_STATUS: Record<ForecastStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  aman: { label: "Sesuai jadwal", tone: "success" },
  waspada: { label: "Perlu percepatan", tone: "warning" },
  telat: { label: "Diprediksi terlambat", tone: "danger" },
  selesai: { label: "Selesai fisik", tone: "success" },
  belum_mulai: { label: "Belum ada realisasi", tone: "neutral" },
  data_kurang: { label: "Data belum cukup", tone: "neutral" },
};
