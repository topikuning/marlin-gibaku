/**
 * PINDAH HARI DI LAPORAN HARIAN – murni, tanpa I/O.
 *
 * Keluhan user 2026-10-08: *"tidak ada kontrol navigasi hari ke hari, terlalu
 * banyak klik, harus kembali ke list kalender, buka lagi satu-satu. saya butuh
 * untuk lihat hari selanjutnya … dalam sekali klik"*.
 *
 * Halaman laporan harian kini punya tombol ke hari sebelum dan sesudah di
 * kepalanya, dan strip "Hari sekitar" berpusat pada tanggal laporan. Dulu
 * strip itu berhenti di tanggal yang sedang dibuka, jadi hari berikutnya tidak
 * pernah terlihat di sana.
 *
 * Tanggal ditulis "YYYY-MM-DD" (kunci tanggal kerja Asia/Jakarta) dan dihitung
 * sebagai tanggal kalender UTC – tidak ada jam, jadi tidak ada geseran zona.
 */

const SEHARI = 86_400_000;

/** Geser kunci tanggal sebanyak `n` hari (negatif = mundur). */
export function geserHari(dateKey: string, n: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + n * SEHARI).toISOString().slice(0, 10);
}

/**
 * Hari sebelum dan sesudah untuk tombol pindah. `sesudah` null bila hari itu
 * belum terjadi: halamannya hanya akan berkata "tanggal ini belum terjadi".
 */
export function tetanggaHari(dateKey: string, todayKey: string): { sebelum: string; sesudah: string | null } {
  const sesudah = geserHari(dateKey, 1);
  return { sebelum: geserHari(dateKey, -1), sesudah: sesudah <= todayKey ? sesudah : null };
}

/** Lebar strip "Hari sekitar". */
export const LEBAR_HARI_SEKITAR = 7;

/**
 * Tujuh hari di sekitar tanggal laporan: tiga sebelum dan tiga sesudah. Ujung
 * kanannya tidak melewati hari ini – jendelanya bergeser ke belakang supaya
 * tetap tujuh hari. Tanggal yang belum terjadi tetap ada di ujung jendela,
 * supaya hari yang sedang dibuka selalu terlihat.
 */
export function jendelaHariSekitar(dateKey: string, todayKey: string): { mulai: string; akhir: string } {
  const separuh = Math.floor(LEBAR_HARI_SEKITAR / 2);
  const batasKanan = dateKey > todayKey ? dateKey : todayKey;
  const kanan = geserHari(dateKey, separuh);
  const akhir = kanan < batasKanan ? kanan : batasKanan;
  return { mulai: geserHari(akhir, -(LEBAR_HARI_SEKITAR - 1)), akhir };
}
