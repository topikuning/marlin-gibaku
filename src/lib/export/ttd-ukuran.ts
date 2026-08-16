/**
 * UKURAN tanda tangan & stempel pada dokumen cetak — SATU sumber untuk penyaji
 * HTML (`components/knmp/blok-ttd.tsx`) dan penyaji PDF (`lib/pdf/ttd-gambar.ts`).
 * DECISIONS 328, disetel ulang atas koreksi user (DECISIONS 329).
 *
 * Semua ukuran diturunkan dari SATU angka — tinggi ruang tanda tangan — supaya
 * tujuh penyaji (empat HTML, tiga PDF) dengan tinggi ruang 32–56 tidak bisa
 * berbeda perbandingan.
 *
 * ### Yang dikoreksi user, dengan foto pembanding
 *
 * User menunjukkan dua gambar: hasil MARLIN (dilingkari merah) dan dokumen asli
 * di lapangan (dilingkari biru). Bedanya dua hal, dan keduanya soal LETAK,
 * bukan cuma ukuran:
 *
 * 1. **Yang asli MENIMPA teks.** Di kertas sungguhan, stempel dicap di atas
 *    baris nama perusahaan dan nama penanda tangan — tintanya menutupi huruf,
 *    dan hurufnya tetap terbaca menembus tinta. Punya MARLIN justru mengambang
 *    rapi di ruang kosong lalu menyenggol garis nama di bawahnya. Itu terbaca
 *    seperti gambar yang ditempel, bukan stempel yang dibubuhkan.
 * 2. **Terlalu besar.** *"tapi jangan terlalu besar."*
 *
 * Karena itu: stempel TIDAK lagi setinggi penuh ruangnya, dan seluruh pasangan
 * (stempel + coretan) DIANGKAT sehingga sisi atasnya melewati batas ruang dan
 * jatuh di atas baris teks, sementara sisi bawahnya justru menjauh dari garis
 * nama. Persis susunan yang ditunjukkan foto asli.
 *
 * Perbandingan benda aslinya tetap jadi acuan: stempel bundar ±4 cm garis
 * tengah, coretan tanda tangan ±3 cm tinggi dan ±5–6 cm lebar.
 *
 * Modul ini MURNI (tanpa I/O, tanpa React) supaya bisa diuji langsung.
 */

/**
 * Tinggi stempel terhadap tinggi ruang. Sengaja DI BAWAH 1: stempel setinggi
 * penuh ruangnya tidak menyisakan tempat untuk diangkat, dan itulah yang
 * membuatnya menabrak garis nama pada versi sebelumnya.
 */
export const NISBAH_STEMPEL = 0.84;
/** Tinggi coretan tanda tangan terhadap tinggi ruang — selalu lebih kecil dari stempel. */
export const NISBAH_TTD = 0.68;
/** Lebar maksimum tanda tangan terhadap TINGGINYA sendiri (coretan itu memanjang). */
export const NISBAH_LEBAR_TTD = 2.4;
/**
 * Geseran stempel ke kiri terhadap tinggi ruang. Meniru cara orang
 * membubuhkannya: stempel dicap MENIMPA sisi kiri tanda tangan, bukan berdiri
 * terpisah di sebelahnya.
 */
export const GESER_STEMPEL = 0.32;
/**
 * Angkat seluruh pasangan ke ATAS terhadap tinggi ruang.
 *
 * Inilah yang membuat stempel jatuh DI ATAS teks seperti dokumen asli: sisi
 * atas stempel melewati batas ruang dan menimpa baris nama perusahaan/jabatan
 * di atasnya, sementara sisi bawahnya menjauh dari garis nama penanda tangan.
 * Huruf yang tertimpa tetap terbaca karena penempelannya `mix-blend-multiply`
 * (HTML) — tinta di atas tinta, bukan kotak putih yang menutup.
 */
export const NAIK = 0.22;

export type UkuranTtd = {
  stempel: { tinggi: number; lebar: number };
  ttd: { tinggi: number; lebarMaks: number };
  /** Piksel/poin geseran stempel ke KIRI dari titik tengah. */
  geser: number;
  /** Piksel/poin seluruh pasangan diangkat dari garis pijaknya. */
  naik: number;
};

/** Turunkan seluruh ukuran gambar dari tinggi ruang tanda tangan. */
export function ukuranTtd(tinggi: number): UkuranTtd {
  const stempel = Math.round(tinggi * NISBAH_STEMPEL);
  return {
    stempel: { tinggi: stempel, lebar: stempel },
    ttd: {
      tinggi: Math.round(tinggi * NISBAH_TTD),
      lebarMaks: Math.round(tinggi * NISBAH_TTD * NISBAH_LEBAR_TTD),
    },
    geser: Math.round(tinggi * GESER_STEMPEL),
    naik: Math.round(tinggi * NAIK),
  };
}
