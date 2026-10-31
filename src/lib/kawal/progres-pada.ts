/**
 * Progres pengawas Kawal pada satu tanggal (DECISIONS 724) – murni.
 *
 * Dipakai MEMBANTU memeriksa angka laporan konsultan yang diketik di Termin &
 * Surat: ditampilkan di sebelahnya, tidak pernah mengisi atau mengubah angka
 * apa pun (data Kawal = rujukan, bukan angka resmi – DECISIONS 690).
 *
 * Minggu Kawal = 7 hari sejak `start_date_penyedia` (terbukti 96/96, DECISIONS
 * 690), bisa berbeda dari nomor minggu kontrak MARLIN (mode Senin–Minggu),
 * jadi pencocokannya lewat TANGGAL, bukan nomor minggu.
 * `kurva_realisasi_kumulatif` = progres pengawas kumulatif per minggu (DECISIONS 693).
 */

const HARI_MS = 86_400_000;

export function progresKawalPada(input: {
  mulai: Date | null;
  realisasiKumulatif: readonly (number | null)[];
  tanggal: Date;
}): { mingguKawal: number; pct: number | null } | null {
  if (!input.mulai) return null;
  const hari = Math.floor((input.tanggal.getTime() - input.mulai.getTime()) / HARI_MS);
  if (hari < 0) return null;
  const mingguKawal = Math.floor(hari / 7) + 1;
  // null = Kawal belum mencatat minggu itu (bukan nol).
  return { mingguKawal, pct: input.realisasiKumulatif[mingguKawal - 1] ?? null };
}
