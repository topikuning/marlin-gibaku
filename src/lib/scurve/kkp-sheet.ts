import { allocateRounded } from "@/lib/round-alloc";

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

export type KurvaSheetCategory = {
  code: string;
  name: string;
  /** Bobot kategori penuh presisi (Σ `weekly`) — untuk perhitungan. */
  bobot: number;
  /** Increment mingguan penuh presisi — untuk perhitungan. */
  weekly: number[];
  /**
   * Bobot TAMPIL (2 desimal). Di Excel kolom "Bobot (%)" ditulis sebagai
   * `=SUM(M1:MN)`, jadi angka ini WAJIB sama persis dengan Σ `weeklyShown`.
   */
  bobotShown: number;
  /** Increment TAMPIL (3 desimal) yang jumlahnya persis `bobotShown`. */
  weeklyShown: number[];
};


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
  /** Σ `bobotShown` seluruh kategori (100,00 bila jadwal menutup 100%). */
  totalBobotShown: number;
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
  /**
   * Kurva rencana RESMI (baseline.points). Bila diberikan, baris "Kumulatif
   * Rencana" & "Rencana per minggu" diturunkan dari sini — SUMBER YANG SAMA
   * dengan planPct halaman-2 dan dashboard. Tanpa ini (fallback), total
   * dihitung dari Σ jadwal kategori, yang bisa berbeda dari kurva resmi
   * setelah baseline diedit manual (audit 2026-07-27, B3: satu dokumen KKP,
   * dua angka rencana).
   */
  planCumOfficial?: number[];
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
  const rawCats = input.categories.map((c) => {
    const weekly = new Array<number>(n).fill(0);
    for (let i = 0; i < n && i < c.weekly.length; i++) weekly[i] = c.weekly[i];
    return { code: c.code, name: c.name, bobot: weekly.reduce((s, v) => s + v, 0), weekly };
  });

  // Angka TAMPIL (layar & Excel) dibulatkan sekali di sini, bukan di tiap
  // renderer, supaya tabel benar-benar menjumlah: Σ sel minggu = bobot barisnya,
  // dan Σ bobot kategori = total tabel. Total dipatok 100,00 HANYA bila selisih
  // jadwal terhadap 100 sebatas galat pembulatan — jadwal yang memang belum
  // menutup 100% ditampilkan apa adanya, jangan dipaksa penuh.
  const rawTotal = rawCats.reduce((s, c) => s + c.bobot, 0);
  const targetTotal = Math.abs(rawTotal - 100) <= 0.05 ? 100 : Math.round(rawTotal * 100) / 100;
  const bobotShown = allocateRounded(rawCats.map((c) => c.bobot), targetTotal, 100);
  const categories: KurvaSheetCategory[] = rawCats.map((c, i) => ({
    ...c,
    bobotShown: bobotShown[i],
    weeklyShown: allocateRounded(c.weekly, bobotShown[i], 1000),
  }));
  const totalBobotShown = Math.round(bobotShown.reduce((s, v) => s + v, 0) * 100) / 100;

  // Baris prestasi — rencana dari kurva RESMI bila tersedia (B3).
  let rencanaPerWeek: number[];
  let kumulatifRencana: number[];
  const official = input.planCumOfficial;
  if (official && official.length > 0) {
    kumulatifRencana = weeks.map((_, i) => {
      const v = official[Math.min(i, official.length - 1)] ?? 0;
      return Math.min(100, Math.round(v * 100) / 100);
    });
    rencanaPerWeek = kumulatifRencana.map((v, i) =>
      Math.max(0, Math.round((v - (i > 0 ? kumulatifRencana[i - 1] : 0)) * 100) / 100),
    );
  } else {
    rencanaPerWeek = weeks.map((_, i) => categories.reduce((s, c) => s + c.weekly[i], 0));
    // Kumulatif dibulatkan 2 desimal — IDENTIK dgn curveFromCategorySchedule
    // (kurva baseline) & format KKP.
    kumulatifRencana = [];
    let run = 0;
    for (const r of rencanaPerWeek) {
      run += r;
      kumulatifRencana.push(Math.min(100, Math.round(run * 100) / 100));
    }
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
    totalBobotShown,
    rencanaPerWeek,
    kumulatifRencana,
    realisasiPerWeek,
    kumulatifRealisasi,
    deviasi,
    currentWeek: Math.max(1, Math.min(input.currentWeek, n)),
  };
}
