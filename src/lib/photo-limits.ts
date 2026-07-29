/**
 * Batas jumlah & ukuran foto — MODUL MURNI, tanpa dependensi server.
 *
 * Dipisah dari `lib/photos.ts` (yang menarik node:crypto, sharp, dan db) supaya
 * komponen KLIEN bisa menampilkan angkanya. Sebelumnya label di form kegiatan
 * ditulis sebagai teks mati "maks 6" — angka milik batas per-unggah laporan
 * harian, bukan batas kegiatan — dan ikut basi saat batasnya dilonggarkan ke 32.
 * Satu sumber angka: label dan penegakannya tidak bisa lagi berbeda.
 */

/** Batas ukuran satu foto (8 MB) — SM di lapangan, sinyal terbatas. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Batas foto per SEKALI unggah di laporan harian. */
export const MAX_PHOTOS_PER_UPLOAD = 6;

/** Batas TOTAL foto per kegiatan lapangan (DECISIONS 116). */
export const MAX_PHOTOS_PER_ACTIVITY = 32;
