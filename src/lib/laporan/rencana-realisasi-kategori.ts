/**
 * LAPORAN RENCANA & REALISASI MINGGUAN PER KATEGORI (DECISIONS 674).
 *
 * Permintaan user 2026-10-14, dengan contoh layar Kawal KNMP: tiap kategori
 * pekerjaan (bangunan) punya baris RENCANA dan REALISASI untuk M1..Mn, plus
 * total lokasi. Isinya disusun SATU kali di sini untuk layar, PDF, dan Excel.
 *
 * Tidak ada rumus baru:
 * - rencana per kategori = matriks lembar Kurva S (`buildKurvaSheet`), jadi
 *   angkanya sama persis dengan halaman Kurva S;
 * - realisasi per kategori = `PeriodReport.realisasiKategoriMingguan`
 *   (`realisasiMingguanKelompok`, rumus garis realisasi kurva-S);
 * - baris total = baris prestasi Kurva S (kurva rencana resmi + realisasi);
 * - ringkasan s/d minggu acuan = `ringkasRencanaRealisasi`.
 */
import { buildKurvaSheet } from "@/lib/scurve/kkp-sheet";
import { ringkasRencanaRealisasi, type RingkasanRencanaRealisasi } from "@/lib/progress-calc";
import type { PeriodReport } from "@/lib/periodic-report";

export type BarisRencanaRealisasi = {
  code: string;
  name: string;
  /** Bobot kategori (% kontrak) – Σ bobot item, sama dengan kolom BOBOT laporan mingguan. */
  bobot: number;
  rencana: number[];
  /** null = minggu sesudah minggu acuan (belum terjadi). */
  realisasi: (number | null)[];
  ringkas: RingkasanRencanaRealisasi;
};

export type LaporanRencanaRealisasi = {
  judul: string;
  /** Minggu acuan (minggu berjalan) – kolom s/d dihitung sampai minggu ini. */
  sampai: number;
  totalMinggu: number;
  monthGroups: { label: string; span: number }[];
  weekRanges: string[];
  baris: BarisRencanaRealisasi[];
  total: {
    bobot: number;
    rencana: number[];
    realisasi: (number | null)[];
    kumRencana: number[];
    kumRealisasi: (number | null)[];
    deviasi: (number | null)[];
    ringkas: RingkasanRencanaRealisasi;
  };
};

export const JUDUL_RENCANA_REALISASI = "LAPORAN RENCANA & REALISASI MINGGUAN PER KATEGORI";

export function susunRencanaRealisasi(r: PeriodReport): LaporanRencanaRealisasi {
  const h = r.header;
  const sheet = buildKurvaSheet({
    categories: r.kurvaSchedule,
    totalWeeks: r.totalWeeks,
    contractStart: h.contractStart,
    weekMode: h.weekMode,
    contractEnd: h.contractEnd,
    actualCum: r.scurve.actualPct,
    currentWeek: r.scurve.currentWeek,
    planCumOfficial: r.scurve.planPct,
  });
  const n = sheet.totalWeeks;
  const sampai = Math.max(1, Math.min(n, r.n));
  const realByKey = new Map(r.realisasiKategoriMingguan.map((k) => [k.lineageKey, k]));
  const baris = sheet.categories.map((c, i): BarisRencanaRealisasi => {
    const lineageKey = r.kurvaSchedule[i]?.lineageKey;
    const asal = lineageKey ? realByKey.get(lineageKey) : undefined;
    const realisasi = Array.from({ length: n }, (_, w) => (w < sampai ? (asal?.weekly[w] ?? 0) : null));
    // Bobot penuh dari RAB (Σ item) – persen terhadap kategori jadi sama persis
    // dengan kolom PROGRES laporan mingguan, bukan dibagi angka yang dibulatkan.
    const bobot = asal?.bobot ?? c.bobot;
    return {
      code: c.code,
      name: c.name,
      bobot,
      rencana: c.weeklyShown,
      realisasi,
      ringkas: ringkasRencanaRealisasi({ rencana: c.bobotShown, realisasi: bobot }, c.weeklyShown, realisasi, sampai),
    };
  });
  return {
    judul: JUDUL_RENCANA_REALISASI,
    sampai,
    totalMinggu: n,
    monthGroups: sheet.monthGroups,
    weekRanges: sheet.weekRanges,
    baris,
    total: {
      bobot: sheet.totalBobotShown,
      rencana: sheet.rencanaPerWeek,
      realisasi: sheet.realisasiPerWeek,
      kumRencana: sheet.kumulatifRencana,
      kumRealisasi: sheet.kumulatifRealisasi,
      deviasi: sheet.deviasi,
      ringkas: ringkasRencanaRealisasi(
        { rencana: sheet.totalBobotShown, realisasi: sheet.totalBobotShown },
        sheet.rencanaPerWeek,
        sheet.realisasiPerWeek,
        sampai,
      ),
    },
  };
}
