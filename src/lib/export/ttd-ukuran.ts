/**
 * UKURAN tanda tangan & stempel pada dokumen cetak — SATU sumber untuk penyaji
 * HTML (`components/knmp/blok-ttd.tsx`) dan penyaji PDF (`lib/pdf/ttd-gambar.ts`).
 * DECISIONS 328.
 *
 * Permintaan user: *"pastikan semua dokumen itu stempel dan ttdnya proporsional
 * di posisinya"*. Empat dokumen HTML memakai tinggi ruang 40–56px dan PDF-nya
 * memakai satuan poin; kalau tiap penyaji memilih ukurannya sendiri, "stempel
 * lebih besar dari tanda tangan" hanya benar di satu tempat. Karena itu SEMUA
 * ukuran diturunkan dari SATU angka — tinggi ruang tanda tangan — memakai
 * perbandingan benda aslinya:
 *
 *   - stempel bundar dinas ≈ 4 cm garis tengah
 *   - coretan tanda tangan ≈ 3 cm tinggi, ≈ 5–6 cm lebar
 *
 * Modul ini MURNI (tanpa I/O, tanpa React) supaya bisa diuji langsung.
 */

/** Tinggi coretan tanda tangan terhadap tinggi ruang. */
export const NISBAH_TTD = 0.82;
/** Lebar maksimum tanda tangan terhadap TINGGINYA sendiri (coretan itu memanjang). */
export const NISBAH_LEBAR_TTD = 2.4;
/**
 * Geseran stempel ke kiri terhadap tinggi ruang. Meniru cara orang
 * membubuhkannya: stempel dicap MENIMPA sisi kiri tanda tangan, bukan berdiri
 * terpisah di sebelahnya.
 */
export const GESER_STEMPEL = 0.38;

export type UkuranTtd = {
  /** Stempel bundar: setinggi & selebar ruangnya. */
  stempel: { tinggi: number; lebar: number };
  ttd: { tinggi: number; lebarMaks: number };
  /** Piksel/poin geseran stempel ke KIRI dari titik tengah. */
  geser: number;
};

/** Turunkan seluruh ukuran gambar dari tinggi ruang tanda tangan. */
export function ukuranTtd(tinggi: number): UkuranTtd {
  return {
    stempel: { tinggi, lebar: tinggi },
    ttd: {
      tinggi: Math.round(tinggi * NISBAH_TTD),
      lebarMaks: Math.round(tinggi * NISBAH_TTD * NISBAH_LEBAR_TTD),
    },
    geser: Math.round(tinggi * GESER_STEMPEL),
  };
}
