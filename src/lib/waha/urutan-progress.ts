import type { UrutanJawaban } from "./parser-niat";

/**
 * Urutkan baris progress — MURNI, dipisah supaya bisa diuji dengan angka yang
 * benar-benar berbeda (DECISIONS 390).
 *
 * Diurutkan atas REALISASI, bukan deviasi. "Progress terbaik" berarti yang
 * paling banyak terealisasi; deviasi menjawab pertanyaan lain ("siapa yang
 * tertinggal dari rencananya"), dan lokasi ber-realisasi 2% bisa saja
 * berdeviasi positif hanya karena rencananya memang belum menuntut apa-apa.
 *
 * Kenapa dipisah dari `dataProgress`: uji integrasinya berjalan di atas lokasi
 * uji yang SEMUANYA berealisasi 0,00%, jadi "menurun" dan "menaik" sama-sama
 * lolos — uji yang terlihat hijau tanpa pernah menguji apa pun. Ketahuan lewat
 * uji gigi: pengurutannya dilepas, ujinya tetap hijau.
 */
export function urutkanProgress<T extends { realisasiPct: number }>(
  baris: T[],
  urutan: UrutanJawaban,
): T[] {
  return [...baris].sort((a, b) =>
    urutan === "terbaik" ? b.realisasiPct - a.realisasiPct : a.realisasiPct - b.realisasiPct,
  );
}
