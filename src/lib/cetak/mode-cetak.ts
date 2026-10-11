/**
 * CARA MENCETAK – MODUL MURNI.
 *
 * Laporan user 2026-10-11: *"aku tidak bisa mencetak jika menggunakan PWA"*.
 *
 * Sampai di sini halaman `/cetak/*` hanya punya satu jalan: `window.print()`.
 * Di peramban biasa itu bekerja. Di aplikasi yang DIPASANG ke layar depan
 * (mode `standalone`) ia sering tidak memunculkan apa-apa – di iPhone hampir
 * pasti, di Android tergantung versi. Tombolnya ditekan, tidak terjadi apa pun,
 * dan pemakai mengira MARLIN rusak.
 *
 * Jalan keluarnya bukan memaksa dialog cetak muncul (tidak ada API untuk itu),
 * melainkan menyerahkan DOKUMENNYA ke tempat yang bisa mencetak:
 *
 * - **Ada PDF resmi** → buka PDF-nya. Penampil PDF bawaan HP/komputer punya
 *   Cetak dan Bagikan sendiri. PDF-nya berkas yang SAMA dengan yang disetor ke
 *   Drive dan dikirim ke WA (DECISIONS 162), jadi tidak ada versi ketiga.
 * - **iPhone** → PDF dijemput di dalam aplikasi lalu diserahkan ke lembar
 *   Bagikan (di sana ada Cetak dan Simpan ke File). Membuka jendela baru tidak
 *   menolong: jendela itu tidak membawa sesi aplikasi terpasang, jadi yang
 *   tampil halaman masuk, bukan PDF.
 * - **Tidak ada PDF** (RAPL, laporan AI, atau pembaca tanpa izin ekspor) →
 *   halaman yang sama dibuka di peramban dengan `?cetak=1`, dan di sana dialog
 *   cetaknya dibuka otomatis.
 *
 * Cetak dari layar (`window.print()`) TETAP ada sebagai tombol kedua: di
 * aplikasi terpasang versi komputer ia bekerja baik.
 *
 * Aturannya dipisah ke modul murni supaya bisa diuji tanpa peramban.
 */

import { PRINT_BACK_PARAM } from "@/lib/print-back";

export const PARAM_CETAK = "cetak";

export type KeadaanCetak = {
  /** Halaman berjalan sebagai aplikasi terpasang. Lihat `iniAplikasiTerpasang`. */
  standalone: boolean;
  /**
   * Alamat PDF resmi dokumen ini. `null` bila dokumennya tidak punya PDF ATAU
   * pembacanya tidak berhak mengekspor – tombol yang berakhir di "Tidak punya
   * izin" lebih buruk daripada tidak ada tombol.
   */
  pdfHref: string | null;
  /** iPhone/iPad. */
  ios: boolean;
  /** Lembar Bagikan bisa menerima berkas (`navigator.canShare({ files })`). */
  bisaBagikanBerkas: boolean;
};

export type AksiCetak = "cetak-layar" | "buka-pdf" | "bagikan-pdf" | "buka-peramban";

export type TombolCetak = { aksi: AksiCetak; label: string };

export type ModeCetak = {
  utama: TombolCetak;
  cadangan: TombolCetak | null;
  /** Kalimat pendek di bawah tombol – hanya di aplikasi terpasang. */
  petunjuk: string | null;
};

const CETAK_LAYAR_UTAMA: TombolCetak = { aksi: "cetak-layar", label: "Cetak / Simpan PDF" };
const CETAK_LAYAR_CADANGAN: TombolCetak = { aksi: "cetak-layar", label: "Cetak halaman ini" };

const PEMBUKA = "Dialog cetak sering tidak muncul di aplikasi terpasang.";

export function modeCetak(k: KeadaanCetak): ModeCetak {
  // Peramban biasa: persis seperti sebelumnya. Yang tidak rusak tidak diubah.
  if (!k.standalone) return { utama: CETAK_LAYAR_UTAMA, cadangan: null, petunjuk: null };

  if (k.pdfHref) {
    if (k.ios && k.bisaBagikanBerkas) {
      const utama: TombolCetak = { aksi: "bagikan-pdf", label: "Bagikan / Cetak PDF" };
      return {
        utama,
        cadangan: CETAK_LAYAR_CADANGAN,
        petunjuk: `${PEMBUKA} Pakai ${utama.label}, lalu pilih Cetak atau Simpan ke File.`,
      };
    }
    const utama: TombolCetak = { aksi: "buka-pdf", label: "Buka PDF" };
    return {
      utama,
      cadangan: CETAK_LAYAR_CADANGAN,
      petunjuk: `${PEMBUKA} Pakai ${utama.label}, lalu cetak atau bagikan dari penampil PDF.`,
    };
  }

  const utama: TombolCetak = { aksi: "buka-peramban", label: "Buka di peramban" };
  return {
    utama,
    cadangan: CETAK_LAYAR_CADANGAN,
    petunjuk:
      `${PEMBUKA} Pakai ${utama.label} – dialog cetaknya langsung muncul di sana.` +
      // Peramban di iPhone tidak berbagi sesi dengan aplikasi terpasang. Lebih
      // baik dikatakan di depan daripada pemakai mengira tombolnya salah arah.
      (k.ios ? " Kalau diminta masuk, masuk dulu lalu buka dokumen ini lagi." : ""),
  };
}

/** Mode tampilan yang berarti "dibuka dari ikon di layar depan". */
export const KUERI_TERPASANG = [
  "(display-mode: standalone)",
  "(display-mode: fullscreen)",
  "(display-mode: minimal-ui)",
] as const;

/**
 * Apakah halaman berjalan sebagai aplikasi terpasang.
 *
 * `cocok` = `(q) => matchMedia(q).matches`, disuntik supaya bisa diuji.
 * `navigatorStandalone` = properti non-standar Safari iOS.
 */
export function iniAplikasiTerpasang(cocok: (kueri: string) => boolean, navigatorStandalone?: boolean): boolean {
  if (navigatorStandalone === true) return true;
  return KUERI_TERPASANG.some((q) => cocok(q));
}

/** Alamat yang sama + `cetak=1`: halaman cetak membuka dialog cetaknya sendiri. */
export function denganCetakOtomatis(href: string): string {
  const relatif = href.startsWith("/") && !href.startsWith("//");
  const u = new URL(href, "http://relatif.invalid");
  u.searchParams.set(PARAM_CETAK, "1");
  return relatif ? `${u.pathname}${u.search}${u.hash}` : u.toString();
}

/** Nilai `?cetak=` dari `searchParams` halaman. */
export function cetakOtomatisDiminta(nilai: string | string[] | undefined): boolean {
  return (Array.isArray(nilai) ? nilai[0] : nilai) === "1";
}

/**
 * Jalur halaman cetak MARLIN dari sebuah tautan, atau null.
 *
 * Dipakai penahan tautan "tab baru" di aplikasi terpasang: di iPhone, tab baru
 * dari aplikasi terpasang terbuka TANPA sesi, jadi tautan cetak ber-
 * `target="_blank"` berakhir di halaman masuk. Hanya `/cetak/*` yang ditahan –
 * halaman itu punya tombol Kembali sendiri. Tautan lain (PDF, berkas, situs
 * luar) dibiarkan: membukanya di tempat bisa menjebak pemakai di layar tanpa
 * jalan kembali.
 *
 * `asalHalaman` (jalur + query halaman yang sedang dibuka) dititipkan sebagai
 * `?dari=` bila tautannya belum membawa – tab baru tidak butuh itu, tapi
 * halaman yang dibuka DI TEMPAT harus tahu ke mana Kembali (DECISIONS 192).
 */
export function tautanCetakDalamAplikasi(href: string, asal: string, asalHalaman?: string): string | null {
  if (!href) return null;
  let u: URL;
  try {
    u = new URL(href, asal);
  } catch {
    return null;
  }
  if (u.origin !== new URL(asal).origin) return null;
  if (!u.pathname.startsWith("/cetak/")) return null;
  if (asalHalaman && !u.searchParams.has(PRINT_BACK_PARAM)) u.searchParams.set(PRINT_BACK_PARAM, asalHalaman);
  return `${u.pathname}${u.search}${u.hash}`;
}
