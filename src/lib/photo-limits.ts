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

/** MB satu berkas, dibulatkan satu desimal — untuk pesan yang menyebut angkanya. */
function mb(byte: number): string {
  return (byte / (1024 * 1024)).toFixed(1).replace(".", ",");
}

/**
 * Berapa berkas dari satu pilihan yang MUAT dalam satu kali unggah, dan kenapa
 * sisanya tidak (DECISIONS 425). MURNI: hanya butuh ukuran tiap berkas.
 *
 * **TIGA** pagar, dan pesannya harus menyebut yang MANA yang kena — "maksimal
 * 20 foto" pada pilihan 8 foto besar adalah pesan yang membingungkan sekaligus
 * salah. Yang tidak muat TIDAK PERNAH dibuang diam-diam; jumlahnya selalu
 * disebutkan.
 *
 * ### Pagar ketiga: ukuran SATU berkas, diperiksa di sini sejak 2026-09-03
 *
 * Sampai hari itu batas per-berkas (25 MB) hanya ditegakkan di server, dan
 * akibatnya ada dua celah yang keduanya persis kegagalan-diam:
 *
 *  1. Foto **26 MB** lolos pemeriksaan ini (26 ≤ anggaran 28 MB), jadi TIDAK
 *     ADA peringatan apa pun. Berkasnya diunggah utuh — di sinyal lapangan itu
 *     menit-menit — baru ditolak server. Peringatan yang datang setelah
 *     ongkosnya dibayar bukan peringatan.
 *  2. Foto **29 MB** membuat `muat = 0`, dan pesannya berbunyi *"Kirim yang ini
 *     dulu, lalu tambahkan lagi"* — padahal tidak ada satu pun yang bisa
 *     dikirim, dan sebab sebenarnya (satu foto itu sendiri kebesaran) tidak
 *     pernah disebut.
 *
 * Berkas kebesaran kini ditolak DI MUKA, disebut ukurannya, dan tidak
 * menghalangi foto lain yang masih wajar di pilihan yang sama.
 */
export type HasilMuatUnggah = {
  /** Indeks berkas yang diterima, urut naik. Bukan selalu awalan daftar. */
  terima: number[];
  /** Sama dengan `terima.length` — dipertahankan untuk pemanggil lama. */
  muat: number;
  /** Berapa berkas yang TIDAK ikut terkirim. */
  sisa: number;
  /** Sebabnya, dalam bahasa manusia. `null` = semuanya muat. */
  pesan: string | null;
};

export function muatSekaliUnggah(ukuran: number[]): HasilMuatUnggah {
  const terima: number[] = [];
  const kebesaran: number[] = [];
  let byte = 0;
  let kenaByte = false;

  for (let i = 0; i < ukuran.length; i++) {
    const u = ukuran[i]!;
    // Pagar per-berkas DULU: berkas 30 MB tidak akan pernah bisa dikirim,
    // sebesar apa pun anggaran yang tersisa. Ia dikeluarkan dari perhitungan,
    // bukan menghabiskan jatah — dan tidak menghentikan yang sesudahnya.
    if (u > MAX_PHOTO_BYTES) {
      kebesaran.push(i);
      continue;
    }
    if (terima.length >= MAX_PHOTOS_PER_UPLOAD) continue;
    if (byte + u > MAX_UPLOAD_BYTES_TOTAL) {
      // Sekali anggaran permintaan penuh, memang penuh.
      kenaByte = true;
      continue;
    }
    byte += u;
    terima.push(i);
  }

  const muat = terima.length;
  const sisa = ukuran.length - muat;
  if (sisa <= 0) return { terima, muat, sisa: 0, pesan: null };

  const bagian: string[] = [];
  if (kebesaran.length > 0) {
    const terbesar = Math.max(...kebesaran.map((i) => ukuran[i]!));
    bagian.push(
      kebesaran.length === 1
        ? `1 foto berukuran ${mb(terbesar)} MB – lebih dari batas ${MAX_PHOTO_MB} MB per foto, jadi tidak bisa dikirim.`
        : `${kebesaran.length} foto lebih dari ${MAX_PHOTO_MB} MB per foto (terbesar ${mb(terbesar)} MB), jadi tidak bisa dikirim.`,
    );
  }
  const sisaLain = sisa - kebesaran.length;
  if (sisaLain > 0) {
    bagian.push(
      kenaByte
        ? `Satu kali kirim maksimal ${MAX_UPLOAD_MB_TOTAL} MB – ${sisaLain} foto belum ikut.`
        : `Satu kali kirim maksimal ${MAX_PHOTOS_PER_UPLOAD} foto – ${sisaLain} foto belum ikut.`,
    );
  }
  // "Kirim yang ini dulu" hanya benar kalau memang ADA yang bisa dikirim.
  // Kalimat itu pada pilihan yang seluruhnya ditolak adalah petunjuk buntu.
  bagian.push(
    muat > 0
      ? "Kirim yang ini dulu, lalu tambahkan lagi."
      : "Belum ada yang bisa dikirim – potret ulang atau pilih foto lain.",
  );
  return { terima, muat, sisa, pesan: bagian.join(" ") };
}
