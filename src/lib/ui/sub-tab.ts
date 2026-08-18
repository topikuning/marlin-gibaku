/**
 * SUB-TAB berbasis query — aturan mainnya, satu tempat (DECISIONS 363).
 *
 * Dipakai halaman yang memuat beberapa bagian setara dan tidak boleh menumpuk
 * semuanya vertikal (Rencana & RAB, Progress lokasi). Dua hal yang gampang
 * rusak diam-diam justru ada di alamatnya, jadi keduanya dikunci di sini:
 *
 *  1. nilai bagian yang tidak dikenal harus JATUH ke bagian yang sah, bukan
 *     menghasilkan halaman kosong;
 *  2. berpindah bagian harus MEMBAWA parameter lain yang sedang berlaku
 *     (minggu yang dilihat, dsb) — kalau tidak, mampir ke bagian lain lalu
 *     kembali membuang pilihan orang, dan itu terbaca seperti data hilang.
 */

/** Default dipakai untuk nilai kosong MAUPUN nilai yang tidak dikenal. */
export function bacaSubTab<T extends string>(
  daftar: readonly T[],
  v: string | undefined | null,
  bawaan: T,
): T {
  return daftar.includes(v as T) ? (v as T) : bawaan;
}

/**
 * Alamat satu bagian, beserta parameter lain yang ikut dibawa.
 *
 * `bagian` SELALU ditulis — juga untuk yang kebetulan default. Tautan tanpa
 * parameter memang mendarat di tempat yang sama hari ini, tapi ia berhenti
 * benar begitu defaultnya diubah, dan kegagalannya sunyi.
 *
 * Nilai `null`/`undefined`/`""` pada `bawaan` DIBUANG, bukan ditulis kosong:
 * `?minggu=` kosong lolos ke `parseInt` sebagai NaN dan menutupi nilai default
 * yang seharusnya dipakai.
 */
export function hrefSubTab(
  path: string,
  bagian: string,
  bawaan: Record<string, string | null | undefined> = {},
): string {
  const q = new URLSearchParams({ bagian });
  for (const [k, v] of Object.entries(bawaan)) {
    if (v != null && v !== "") q.set(k, v);
  }
  return `${path}?${q.toString()}`;
}
