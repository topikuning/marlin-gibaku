/**
 * KUNCI KETUKAN ULANG — berapa lama ketukan kedua ke alamat yang sama ditahan.
 *
 * Latar (DECISIONS 247): diukur pada 400 kbps, tiga ketukan beruntun pada satu
 * lokasi menghasilkan tiga permintaan halaman penuh. Tiap duplikat mencuri
 * jatah pipa dari permintaan yang sebetulnya hampir selesai, jadi makin sering
 * diketuk makin lambat — lingkaran yang dilaporkan dari lapangan. Karena itu
 * ketukan ulang ditahan.
 *
 * TAPI PENAHANANNYA HARUS PUNYA UJUNG. Menahan sampai batas aman 20 detik
 * berarti: kalau sebuah ketukan ternyata tidak berujung navigasi (dibatalkan
 * komponen lain, tautan mati), pengguna mengetuk lagi dan benar-benar tidak
 * terjadi apa pun — persis keluhan yang sedang diperbaiki, cuma sekarang
 * kitalah penyebabnya.
 *
 * Ujungnya disamakan dengan saat pemberitahuan "jaringan sepertinya lambat"
 * muncul. Sesudah kalimat itu tampil, pengguna sudah diberi tahu keadaannya;
 * menahan ketukannya lebih lama tidak lagi melindungi siapa pun, ia cuma
 * merampas kendali. Kedua angka datang dari SATU konstanta supaya tidak bisa
 * menyimpang diam-diam — kalau nanti geser, keduanya geser bersama.
 *
 * Pakai jam, bukan `setTimeout`: pemeriksaannya toh hanya perlu terjadi saat
 * ada ketukan, dan menghapus pengatur waktu berarti tidak ada yang bisa
 * tertinggal hidup sesudah komponennya lepas.
 */

/** Sesudah sekian lama, diam kembali membingungkan — katakan sebabnya. */
export const AMBANG_LAMBAT_MS = 6000;

/**
 * Jaring pengaman bar progres: padam sendiri kalau ketukan ternyata tidak
 * berujung navigasi. Tanpa ini, satu kasus tepi menyisakan bar menyala
 * selamanya — dan indikator yang berbohong lebih buruk daripada tidak ada.
 */
export const BATAS_AMAN_MS = 20_000;

/** Ketukan yang sedang diproses; `sampai` = kapan kuncinya kedaluwarsa. */
export type KetukanAktif = { href: string; sampai: number };

/**
 * Haruskah ketukan ke `href` ditahan sebagai duplikat?
 *
 * Hanya alamat yang SAMA PERSIS yang ditahan. Ketukan ke tujuan lain selalu
 * lolos — pengguna yang berubah pikiran tidak boleh ikut terkunci.
 */
export function tahanKetukan(
  aktif: KetukanAktif | null,
  href: string,
  sekarang: number,
): boolean {
  return aktif !== null && aktif.href === href && sekarang < aktif.sampai;
}

/** Kunci untuk ketukan yang baru saja diterima. */
export function kunciKetukan(href: string, sekarang: number): KetukanAktif {
  return { href, sampai: sekarang + AMBANG_LAMBAT_MS };
}
