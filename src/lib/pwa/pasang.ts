/**
 * ATURAN TOMBOL "PASANG APLIKASI" — MODUL MURNI (DECISIONS 405).
 *
 * Permintaan user 2026-08-21: *"untuk pwa pada android, di chrome ada pilihan
 * install. apakah kamu bisa force memberi pilihan install tanpa harus masuk
 * menu chrome untuk install"*
 *
 * Bisa, dan hanya dengan satu cara: `beforeinstallprompt`. Chrome menembakkan
 * event itu ketika aplikasinya memenuhi syarat pasang; kita menahannya
 * (`preventDefault`), menyimpannya, lalu memunculkan tombol sendiri. Menekan
 * tombol memanggil `prompt()` dan dialog pasang Android muncul — TANPA membuka
 * menu ⋮.
 *
 * Yang TIDAK bisa, dan perlu disebut supaya tidak dijanjikan:
 *
 * 1. **Memasang tanpa ketukan.** `prompt()` hanya sah dipanggil dari gestur
 *    pemakai. Peramban menolaknya kalau dipanggil sendiri saat halaman dibuka.
 * 2. **Memaksa Chrome menganggap aplikasinya bisa dipasang.** Kalau syaratnya
 *    tak terpenuhi (manifest, ikon 192+512, `start_url`, `display`, HTTPS,
 *    service worker ber-`fetch`), event-nya tidak pernah datang dan tidak ada
 *    tombol yang bisa dipaksa muncul.
 * 3. **iOS.** Safari tidak punya `beforeinstallprompt` sama sekali. Di sana
 *    satu-satunya jalan tetap Bagikan → "Tambahkan ke Layar Utama", jadi yang
 *    bisa kita berikan cuma petunjuknya.
 *
 * Aturannya dipisah ke modul murni supaya bisa diuji tanpa peramban — yang
 * paling mudah salah bukan pemanggilan `prompt()`-nya, melainkan KAPAN
 * tombolnya pantas muncul.
 */

/** Berapa lama tawaran didiamkan sesudah pemakai menutupnya. */
export const JEDA_TOLAK_HARI = 14;

export const KUNCI_TOLAK = "marlin.pasang.ditolak";

export type KeadaanPasang = {
  /** Chrome sudah menawarkan (event `beforeinstallprompt` tertangkap). */
  adaTawaran: boolean;
  /** Aplikasi sedang berjalan sebagai aplikasi terpasang. */
  sudahTerpasang: boolean;
  /** Peramban iOS yang tidak punya `beforeinstallprompt`. */
  ios: boolean;
  /** Cap waktu penolakan terakhir (ms), atau null. */
  ditolakPada: number | null;
  /** Sekarang (ms) — disuntik supaya bisa diuji. */
  sekarang: number;
};

/** Apa yang pantas ditampilkan: tombol pasang, petunjuk iOS, atau tidak apa-apa. */
export type TawaranPasang = "tombol" | "petunjuk-ios" | "tidak";

export function tawaranPasang(k: KeadaanPasang): TawaranPasang {
  /*
   * Sudah terpasang MENANG atas segalanya. Menawarkan pasang kepada orang yang
   * sedang MEMAKAI aplikasi terpasangnya adalah cara tercepat membuat banner
   * MARLIN dianggap sampah dan diabaikan seterusnya — termasuk saat ia membawa
   * kabar yang penting.
   */
  if (k.sudahTerpasang) return "tidak";

  // Penolakan didiamkan, TIDAK dilupakan: sesudah jeda ia boleh menawar lagi
  // karena keadaan orang berubah (ganti HP, mulai kerja di lapangan).
  if (k.ditolakPada !== null) {
    const umurHari = (k.sekarang - k.ditolakPada) / 86_400_000;
    // Cap waktu dari masa depan = jam HP dimundurkan atau data rusak.
    // Diperlakukan sebagai "belum pernah menolak", bukan didiamkan selamanya.
    if (umurHari >= 0 && umurHari < JEDA_TOLAK_HARI) return "tidak";
  }

  if (k.adaTawaran) return "tombol";
  // Petunjuk iOS hanya berguna kalau memang tidak ada jalur otomatis.
  return k.ios ? "petunjuk-ios" : "tidak";
}

/** Peramban iOS (termasuk Chrome/Firefox di iOS – semuanya WebKit). */
export function iniIos(ua: string, maxTouchPoints = 0, platform = ""): boolean {
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ menyamar sebagai Macintosh; yang membedakannya cuma layar sentuh.
  return platform === "MacIntel" && maxTouchPoints > 1;
}
