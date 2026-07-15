import { categoryPlannedFraction } from "./generate";

/**
 * Data untuk sheet "KURVA S" resmi KKP (halaman-1 laporan periodik): tabel bobot
 * kategori × minggu (increment per minggu) + baris prestasi + garis kurva-S.
 * MURNI (tanpa DB) — bisa diuji & dipakai di server component.
 */

const MONTHS_ID = [
  "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
  "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER",
];
const DAY = 24 * 3600 * 1000;

export type KurvaSheetCategory = { code: string; name: string; bobot: number; weekly: number[] };

export type KurvaSheet = {
  totalWeeks: number;
  weeks: number[];
  /** Kelompok bulan utk header kolom (span = jumlah minggu di bulan itu). */
  monthGroups: { label: string; span: number }[];
  categories: KurvaSheetCategory[];
  rencanaPerWeek: number[];
  kumulatifRencana: number[];
  realisasiPerWeek: (number | null)[];
  kumulatifRealisasi: (number | null)[];
  deviasi: (number | null)[];
  currentWeek: number;
};

export function buildKurvaSheet(input: {
  categories: { code: string; name: string; bobot: number }[];
  totalWeeks: number;
  contractStart: Date;
  /** Kumulatif realisasi % per minggu (null utk minggu > minggu berjalan). */
  actualCum: (number | null)[];
  currentWeek: number;
}): KurvaSheet {
  const n = Math.max(1, input.totalWeeks);
  const weeks = Array.from({ length: n }, (_, i) => i + 1);

  // Kelompok bulan dari tanggal minggu (contractStart + (w−1)×7 hari).
  const monthGroups: { label: string; span: number }[] = [];
  for (const w of weeks) {
    const d = new Date(input.contractStart.getTime() + (w - 1) * 7 * DAY);
    const label = MONTHS_ID[d.getUTCMonth()];
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.label === label) last.span += 1;
    else monthGroups.push({ label, span: 1 });
  }

  // Increment bobot per kategori per minggu.
  const categories: KurvaSheetCategory[] = input.categories.map((c) => {
    const weekly: number[] = [];
    for (const w of weeks) {
      const inc = c.bobot * (categoryPlannedFraction(c.name, w, n) - categoryPlannedFraction(c.name, w - 1, n));
      weekly.push(Math.max(0, inc));
    }
    return { code: c.code, name: c.name, bobot: c.bobot, weekly };
  });

  // Baris prestasi.
  const rencanaPerWeek = weeks.map((_, i) => categories.reduce((s, c) => s + c.weekly[i], 0));
  const kumulatifRencana: number[] = [];
  let run = 0;
  for (const r of rencanaPerWeek) {
    run += r;
    kumulatifRencana.push(run);
  }
  const kumulatifRealisasi = weeks.map((_, i) => input.actualCum[i] ?? null);
  const realisasiPerWeek = weeks.map((_, i) => {
    const cur = kumulatifRealisasi[i];
    if (cur == null) return null;
    const prev = i > 0 ? (kumulatifRealisasi[i - 1] ?? 0) : 0;
    return Math.max(0, cur - prev);
  });
  const deviasi = weeks.map((_, i) => {
    const act = kumulatifRealisasi[i];
    return act == null ? null : act - kumulatifRencana[i];
  });

  return {
    totalWeeks: n,
    weeks,
    monthGroups,
    categories,
    rencanaPerWeek,
    kumulatifRencana,
    realisasiPerWeek,
    kumulatifRealisasi,
    deviasi,
    currentWeek: Math.max(1, Math.min(input.currentWeek, n)),
  };
}
