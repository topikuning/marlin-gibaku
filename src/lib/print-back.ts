/**
 * Tujuan tombol "Kembali" di halaman cetak.
 *
 * Halaman cetak bisa dibuka dari beberapa tempat berbeda (halaman laporan
 * harian tanggal tsb, daftar laporan lokasi, daftar laporan global). Dulu
 * `backHref`-nya DIPAKU ke daftar laporan lokasi, jadi ke mana pun asalnya
 * pengguna selalu dilempar ke sana — dan di halaman itu ada laporan mingguan,
 * sehingga terasa "nyasar ke laporan mingguan padahal tadi laporan harian
 * tanggal tertentu". Laporan user 2026-07-31, DECISIONS 192.
 *
 * Sekarang asal halaman dikirim lewat query `?dari=`, dan tujuan cadangannya
 * adalah halaman yang paling masuk akal untuk dokumen itu sendiri.
 */

export const PRINT_BACK_PARAM = "dari";

/**
 * Terima HANYA path internal absolut ("/proyek/lokasi/..."). Menolak URL absolut,
 * protocol-relative ("//jahat.example"), dan backslash — supaya parameter ini
 * tidak bisa dipakai melempar pengguna ke situs luar (open redirect).
 */
export function safeBackPath(raw: string | undefined | null, fallback: string): string {
  if (!raw) return fallback;
  const v = raw.trim();
  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//") || v.startsWith("/\\")) return fallback;
  if (v.includes("\\")) return fallback;
  // "/../" tidak berbahaya di router Next, tapi tidak pernah kita hasilkan.
  if (v.includes("..")) return fallback;
  return v;
}

/** Tambahkan asal halaman ke URL cetak. */
export function withBackTo(printHref: string, from: string): string {
  return `${printHref}?${PRINT_BACK_PARAM}=${encodeURIComponent(from)}`;
}
