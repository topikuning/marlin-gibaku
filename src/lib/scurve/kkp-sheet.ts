import { classifyStage, detectWorkType, stagePlannedFraction } from "./sequencing";

/**
 * Data untuk sheet "KURVA S" resmi KKP (halaman-1 laporan periodik): tabel bobot
 * kategori × minggu (increment per minggu) + baris prestasi + garis kurva-S.
 * MURNI (tanpa DB) — bisa diuji & dipakai di server component.
 *
 * PENTING: distribusi per minggu dihitung PER ITEM lewat penjadwalan BERURUT
 * per-unit (sequencing.ts: tipe pekerjaan unit → tahap item) lalu dijumlahkan ke
 * kategori — SAMA dgn model baseline (scheduleBySequence). Jadi kumulatif rencana
 * di sheet KKP IDENTIK dgn baseline/kurva-S yang dipakai progress & deviasi.
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
  /** Kategori beserta item-nya (nama + bobot) — distribusi per item (trade). */
  categories: { code: string; name: string; items: { name: string; bobot: number }[] }[];
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

  // Tipe pekerjaan per UNIT (kategori) — konsisten dgn scheduleBySequence.
  const typeByCat = new Map(
    input.categories.map((c) => [c.name, detectWorkType(c.name, c.items.map((it) => it.name))]),
  );

  // Increment bobot per kategori per minggu = Σ item (tahap item) — identik dgn
  // baseline. Pra-hitung fraksi tahap per minggu (cache per workType|stage).
  const fracCache = new Map<string, number[]>();
  const stageFrac = (workType: ReturnType<typeof detectWorkType>, name: string, catName: string): number[] => {
    const stage = classifyStage(workType, name, catName);
    const cacheKey = `${workType}|${stage}`;
    let arr = fracCache.get(cacheKey);
    if (!arr) {
      arr = [0, ...weeks.map((w) => stagePlannedFraction(workType, stage, w, n))]; // index 0 = minggu 0
      fracCache.set(cacheKey, arr);
    }
    return arr;
  };
  const categories: KurvaSheetCategory[] = input.categories.map((c) => {
    const workType = typeByCat.get(c.name)!;
    const weekly = new Array<number>(n).fill(0);
    let bobot = 0;
    for (const it of c.items) {
      bobot += it.bobot;
      const frac = stageFrac(workType, it.name, c.name);
      for (let i = 0; i < n; i++) weekly[i] += it.bobot * Math.max(0, frac[i + 1] - frac[i]);
    }
    return { code: c.code, name: c.name, bobot, weekly };
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
