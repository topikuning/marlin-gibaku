import { normalizePhone } from "./sender-identity";

/**
 * ATURAN VERIFIKASI NOMOR WHATSAPP — MODUL MURNI, tanpa DB dan tanpa jaringan.
 *
 * Permintaan user 2026-09-13: sesudah login, pengguna diminta mengirim WA dari
 * nomornya sendiri, dibalas kode, lalu kodenya diketikkan. Boleh dilewati, tapi
 * ditanyakan lagi tiap kali login sampai selesai. Sekaligus itulah cara nomor
 * WA-nya terisi kalau masih kosong, atau diperbarui kalau nomornya berganti.
 *
 * Dipisah dari sisi database supaya aturannya bisa diuji apa adanya — aturan
 * keamanan yang tidak diuji sama saja dengan tidak ada.
 */

/** Awalan frasa. Sengaja terbaca manusia: orang harus berani mengirimnya. */
export const AWALAN_FRASA = "MARLIN-";

/**
 * Huruf & angka TANPA yang mudah tertukar (0/O, 1/I/L, 5/S, 8/B).
 *
 * Frasa ini dibaca dari layar lalu diketik ulang di WhatsApp, sering di
 * lapangan, sering dengan layar retak. Satu huruf yang tertukar berarti
 * pesannya masuk tapi tidak dikenali, dan yang terbaca orang cuma "tidak
 * terjadi apa-apa" — kegagalan paling membingungkan dari semua.
 */
const ABJAD = "ACDEFGHJKMNPQRTUVWXY234679";

/** Berapa lama satu percobaan verifikasi berlaku. */
export const MENIT_BERLAKU = 15;

/** Salah ketik kode sebanyak ini = percobaannya hangus, harus mulai lagi. */
export const MAKS_PERCOBAAN = 5;

/**
 * Frasa sekali-pakai. `acak` disuntik saat diuji supaya hasilnya bisa dipastikan.
 *
 * Panjang 6 dari 27 abjad ≈ 387 juta kemungkinan — cukup supaya menebak frasa
 * orang lain tidak masuk akal, sementara masih bisa diketik di WhatsApp tanpa
 * membuat orang menyerah.
 */
export function buatFrasa(acak: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ABJAD[Math.floor(acak() * ABJAD.length)];
  return `${AWALAN_FRASA}${s}`;
}

/** Kode balasan 6 angka. Dikirim lewat WhatsApp, diketik di layar. */
export function buatKode(acak: () => number = Math.random): string {
  return String(Math.floor(acak() * 1_000_000)).padStart(6, "0");
}

/**
 * Ambil frasa verifikasi dari sebuah pesan WhatsApp, atau `null`.
 *
 * Sengaja LONGGAR terhadap cara orang mengetik: huruf kecil, spasi di mana-mana,
 * tanda kutip dari papan ketik ponsel, dan kalimat pengiring ("halo, MARLIN-ABC123
 * ya") semuanya tetap dikenali. Yang ketat cuma bentuk frasanya sendiri.
 *
 * Ini bukan kelonggaran demi kenyamanan: pesan yang MEMUAT frasa tapi ditolak
 * karena ada kata "halo" di depannya akan dibaca orang sebagai sistem yang
 * rusak, dan mereka akan mengulanginya dengan cara yang sama persis.
 */
export function frasaDariPesan(teks: string | null | undefined): string | null {
  if (!teks) return null;
  const m = new RegExp(`${AWALAN_FRASA}([${ABJAD}]{6})`, "i").exec(teks.toUpperCase());
  return m ? `${AWALAN_FRASA}${m[1]!.toUpperCase()}` : null;
}

export type KeadaanVerifikasi =
  | { tahap: "belum" }
  | { tahap: "menunggu-pesan"; frasa: string; kedaluwarsa: Date }
  | { tahap: "menunggu-kode"; nomor: string | null; kedaluwarsa: Date; sisaPercobaan: number }
  /**
   * Pesannya MASUK, tapi kodenya tidak berhasil dikirim balik.
   *
   * Keadaan ini punya namanya sendiri karena tanpa itu ia menyamar jadi
   * "menunggu-pesan" — layar menyuruh mengirim ulang pesan yang sebenarnya
   * sudah sampai, dan orangnya mengirim lagi, dan lagi. DECISIONS 576.
   */
  | { tahap: "gagal-kirim"; nomor: string | null }
  | { tahap: "selesai"; nomor: string | null; kapan: Date };

export type BarisVerifikasi = {
  phrase: string;
  code: string | null;
  senderKey: string | null;
  waNumber: string | null;
  attempts: number;
  expiresAt: Date;
};

/**
 * Tahap yang sedang berjalan, dari sudut pandang layar.
 *
 * Percobaan yang KEDALUWARSA dibaca sebagai "belum", bukan sebagai tahap yang
 * menggantung: yang sudah lewat waktunya tidak boleh menahan orang di layar
 * yang menunggu sesuatu yang tidak akan pernah datang.
 */
export function keadaanVerifikasi(
  baris: BarisVerifikasi | null,
  terverifikasiPada: Date | null,
  nomor: string | null,
  sekarang = new Date(),
): KeadaanVerifikasi {
  if (terverifikasiPada) return { tahap: "selesai", nomor, kapan: terverifikasiPada };
  if (!baris || baris.expiresAt.getTime() <= sekarang.getTime()) return { tahap: "belum" };
  if (!baris.code) {
    // Identitas pengirim sudah tercap = pesannya SAMPAI. Kalau kodenya tetap
    // kosong, yang gagal kirimannya — bukan pesan orangnya.
    if (baris.senderKey || baris.waNumber) return { tahap: "gagal-kirim", nomor: baris.waNumber };
    return { tahap: "menunggu-pesan", frasa: baris.phrase, kedaluwarsa: baris.expiresAt };
  }
  return {
    tahap: "menunggu-kode",
    nomor: baris.waNumber,
    kedaluwarsa: baris.expiresAt,
    sisaPercobaan: Math.max(0, MAKS_PERCOBAAN - baris.attempts),
  };
}

export type HasilCocokKode =
  | { ok: true }
  | { ok: false; sebab: "kedaluwarsa" | "belum-ada-pesan" | "habis-percobaan" | "kode-salah" };

/**
 * Apakah kode yang diketik cocok? Perbandingannya disengaja TIDAK peka spasi
 * dan tanda baca — orang menyalin kode dari WhatsApp beserta pengiringnya.
 */
export function cocokkanKode(
  baris: BarisVerifikasi | null,
  diketik: string,
  sekarang = new Date(),
): HasilCocokKode {
  if (!baris || baris.expiresAt.getTime() <= sekarang.getTime()) return { ok: false, sebab: "kedaluwarsa" };
  if (!baris.code) return { ok: false, sebab: "belum-ada-pesan" };
  if (baris.attempts >= MAKS_PERCOBAAN) return { ok: false, sebab: "habis-percobaan" };
  const bersih = diketik.replace(/[^0-9]/g, "");
  return bersih === baris.code ? { ok: true } : { ok: false, sebab: "kode-salah" };
}

/**
 * Tautan yang MEMBUKA WhatsApp dengan frasanya sudah terketik ke nomor MARLIN.
 *
 * Teguran user 2026-09-13: *"seharusnya kirim kode ini kamu sediakan klik, dia
 * langsung buka whatsapp pesannya siap kirim ke nomor marlin."* Versi pertama
 * layar ini menampilkan frasa lalu menyuruh orang menyalinnya, membuka
 * WhatsApp, mencari nomor MARLIN, dan mengetik ulang. Empat kesempatan gagal
 * untuk satu langkah yang bisa jadi satu ketukan — dan tiga di antaranya
 * berakhir sama: pesannya tidak pernah sampai, tanpa satu pun tanda di layar.
 *
 * `null` bila nomornya tidak diketahui (sesi WhatsApp MARLIN sedang putus).
 * Tombol yang membuka WhatsApp ke nomor kosong lebih buruk daripada tidak ada
 * tombol: orang mengira sudah mengirim.
 */
export function tautanKirimWa(nomor: string | null | undefined, frasa: string): string | null {
  if (!nomor) return null;
  // Tautannya hanya menerima angka: "+62 812-3456-789", "0812…", dan JID
  // "628…@c.us" harus dirapikan dulu — aturan yang sama dengan pencocokan
  // nomor di tempat lain.
  const bersih = normalizePhone(nomor);
  if (!bersih) return null;
  // Bentuk `api.whatsapp.com/send/` dengan `type=phone_number&app_absent=0`,
  // bukan `wa.me`: di peramban desktop wa.me berhenti di halaman antara yang
  // menyuruh orang menekan "Continue to Chat" sekali lagi, dan di ponsel tanpa
  // WhatsApp terpasang ia diam saja. Bentuk ini yang dipakai user.
  return `https://api.whatsapp.com/send/?phone=${bersih}&text=${encodeURIComponent(
    frasa,
  )}&type=phone_number&app_absent=0`;
}
