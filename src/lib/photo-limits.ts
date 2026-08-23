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

/**
 * Batas foto per SEKALI unggah di laporan harian.
 *
 * DINAIKKAN 6 → 20 (DECISIONS 425). Keberatan user 2026-08-23: *"sekali upload
 * pilih foto dari galeri kenapa cuma dibatasi 6? sementara bisa menambahkan
 * lagi."* — dan itu tepat: angka 6 tidak melindungi apa pun, karena mengunggah
 * lagi sesudahnya SELALU boleh. Yang ia lakukan hanya memaksa memilih berulang
 * kali dari galeri, pekerjaan yang paling merepotkan justru di HP.
 *
 * Yang benar-benar mengikat bukan JUMLAHNYA melainkan UKURAN PERMINTAAN: server
 * action dibatasi 30 MB (`next.config.ts`). Itu pagar yang nyata, jadi itu yang
 * ditegakkan — lihat `MAX_UPLOAD_BYTES_TOTAL`.
 */
export const MAX_PHOTOS_PER_UPLOAD = 20;

/**
 * Batas TOTAL byte satu kali unggah, di bawah `bodySizeLimit` 30 MB.
 *
 * Sisanya untuk overhead multipart + medan formulir lain. Tanpa batas ini,
 * melonggarkan jumlah foto hanya memindahkan kegagalan ke tempat yang lebih
 * buruk: permintaan yang ditolak server dengan pesan teknis, sesudah pengunggahan
 * berjalan lama di sinyal lapangan. Lebih baik dikatakan di muka, sebelum
 * satu byte pun dikirim.
 */
export const MAX_UPLOAD_BYTES_TOTAL = 28 * 1024 * 1024;

/** Label MB untuk pesan & UI — satu sumber, tidak bisa basi. */
export const MAX_UPLOAD_MB_TOTAL = Math.round(MAX_UPLOAD_BYTES_TOTAL / (1024 * 1024));

/** Batas TOTAL foto per kegiatan lapangan (DECISIONS 116). */
export const MAX_PHOTOS_PER_ACTIVITY = 32;

/**
 * Berapa berkas dari satu pilihan yang MUAT dalam satu kali unggah, dan kenapa
 * sisanya tidak (DECISIONS 425). MURNI: hanya butuh ukuran tiap berkas.
 *
 * Dua pagar, dan pesannya harus menyebut yang MANA yang kena — "maksimal 20
 * foto" pada pilihan 8 foto besar adalah pesan yang membingungkan sekaligus
 * salah. Yang tidak muat TIDAK PERNAH dibuang diam-diam; jumlahnya selalu
 * disebutkan.
 */
export function muatSekaliUnggah(ukuran: number[]): {
  muat: number;
  sisa: number;
  pesan: string | null;
} {
  let byte = 0;
  let muat = 0;
  let kenaByte = false;
  for (const u of ukuran) {
    if (muat >= MAX_PHOTOS_PER_UPLOAD) break;
    if (byte + u > MAX_UPLOAD_BYTES_TOTAL) {
      // Satu berkas raksasa di tengah daftar tidak boleh menghentikan yang
      // kecil sesudahnya — tapi sekali penuh, memang penuh.
      kenaByte = true;
      break;
    }
    byte += u;
    muat += 1;
  }
  const sisa = ukuran.length - muat;
  if (sisa <= 0) return { muat, sisa: 0, pesan: null };
  return {
    muat,
    sisa,
    pesan: kenaByte
      ? `Satu kali kirim maksimal ${MAX_UPLOAD_MB_TOTAL} MB – ${sisa} foto terakhir belum ikut. Kirim yang ini dulu, lalu tambahkan lagi.`
      : `Satu kali kirim maksimal ${MAX_PHOTOS_PER_UPLOAD} foto – ${sisa} foto terakhir belum ikut. Kirim yang ini dulu, lalu tambahkan lagi.`,
  };
}
