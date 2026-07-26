/**
 * Data untuk sheet "KURVA S" resmi KKP (halaman-1 laporan periodik): tabel bobot
 * kategori × minggu (increment per minggu) + baris prestasi + garis kurva-S.
 * MURNI (tanpa DB) — bisa diuji & dipakai di server component.
 *
 * PENTING (DECISIONS 079): distribusi per minggu = JADWAL TERSIMPAN per kategori
 * (BaselineScheduleItem: bobot + jendela minggu), disebar rata dalam jendelanya —
 * SAMA dgn kurva baseline (curveFromCategorySchedule). Jadi kumulatif rencana di
 * tabel KKP IDENTIK dgn grafik & deviasi, dan IKUT saat kurva-S disesuaikan manual.
 * (Dulu tabel ini menghitung ulang dari model auto → tak sinkron dgn edit manual.)
 */

const MONTHS_ID = [
  "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
  "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER",
];
const DAY = 24 * 3600 * 1000;

export type KurvaSheetCategory = { code: string; name: string; bobot: number; weekly: number[] };

/**
 * Urutkan baris kategori mengikuti URUTAN RAB (sortOrder → nomor romawi I, II,
 * III, …). Jadwal tersimpan (BaselineScheduleItem) maupun hasil penjadwalan
 * otomatis datang dalam urutan penyimpanan/penjadwalan, bukan urutan RAB —
 * kalau dipakai apa adanya, tabel KKP menampilkan romawi meloncat
 * (mis. XIV, XV, …, lalu I, II). Kategori yang tidak ada di daftar RAB
 * diletakkan di belakang dengan urutan relatifnya dipertahankan. MURNI.
 */
export function orderCategoriesByRab<T extends { name: string }>(
  categories: T[],
  /** Nama kategori RAB urut `sortOrder` (indeksnya = urutan romawi). */
  rabOrder: string[],
): T[] {
  const rank = new Map<string, number>();
  rabOrder.forEach((name, i) => {
    if (!rank.has(name)) rank.set(name, i);
  });
  const last = rabOrder.length;
  return categories
    .map((c, i) => ({ c, i, r: rank.get(c.name) ?? last }))
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.i - b.i))
    .map((x) => x.c);
}

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
  /** Profil mingguan per kategori (increment %/minggu) — dari jadwal berbasis item. */
  categories: { code: string; name: string; weekly: number[] }[];
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

  // Profil mingguan per kategori sudah dihitung dari jadwal berbasis ITEM
  // (tahap bersarang di jendela kategori; DECISIONS 082) → tinggal dipakai.
  const categories: KurvaSheetCategory[] = input.categories.map((c) => {
    const weekly = new Array<number>(n).fill(0);
    for (let i = 0; i < n && i < c.weekly.length; i++) weekly[i] = c.weekly[i];
    return { code: c.code, name: c.name, bobot: weekly.reduce((s, v) => s + v, 0), weekly };
  });

  // Baris prestasi.
  const rencanaPerWeek = weeks.map((_, i) => categories.reduce((s, c) => s + c.weekly[i], 0));
  // Kumulatif dibulatkan 2 desimal — IDENTIK dgn curveFromCategorySchedule (kurva
  // baseline) & format KKP. Jadi tabel, grafik, dan deviasi memakai angka sama.
  const kumulatifRencana: number[] = [];
  let run = 0;
  for (const r of rencanaPerWeek) {
    run += r;
    kumulatifRencana.push(Math.min(100, Math.round(run * 100) / 100));
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
