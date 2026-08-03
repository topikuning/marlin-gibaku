/**
 * Batas jumlah & ukuran foto — MODUL MURNI, tanpa dependensi server.
 *
 * Dipisah dari `lib/photos.ts` (yang menarik node:crypto, sharp, dan db) supaya
 * komponen KLIEN bisa menampilkan angkanya. Sebelumnya label di form kegiatan
 * ditulis sebagai teks mati "maks 6" — angka milik batas per-unggah laporan
 * harian, bukan batas kegiatan — dan ikut basi saat batasnya dilonggarkan ke 32.
 * Satu sumber angka: label dan penegakannya tidak bisa lagi berbeda.
 */

/**
 * Batas ukuran satu foto sebelum diproses.
 *
 * DINAIKKAN 8 MB → 25 MB (DECISIONS 229). Angka 8 MB dipilih dengan alasan
 * "sinyal terbatas di lapangan", tapi itu melindungi hal yang salah: server
 * MEMANG mengompres tiap foto sebelum menyimpan, jadi batas ini tidak
 * menentukan besarnya berkas tersimpan — ia hanya menentukan foto mana yang
 * DITOLAK MENTAH-MENTAH.
 *
 * Dan yang ditolak itu foto normal: kamera 48–108 MP di HP kelas menengah
 * sekarang menghasilkan JPEG 10–20 MB. Mandor yang baru saja memotret bukti
 * lalu diberi tahu "foto terlalu besar" tidak punya jalan keluar di lapangan —
 * ia tidak akan mengecilkan berkas, ia akan berhenti melampirkan bukti.
 *
 * Batas tetap ada (25 MB) sebagai pagar terhadap berkas yang jelas bukan foto
 * lapangan — video salah pilih, PSD, RAW.
 */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** Label batas ukuran untuk pesan & UI — satu sumber, tidak bisa basi. */
export const MAX_PHOTO_MB = Math.round(MAX_PHOTO_BYTES / (1024 * 1024));

/** Batas foto per SEKALI unggah di laporan harian. */
export const MAX_PHOTOS_PER_UPLOAD = 6;

/** Batas TOTAL foto per kegiatan lapangan (DECISIONS 116). */
export const MAX_PHOTOS_PER_ACTIVITY = 32;
