/**
 * SATU cara menentukan kategori sebuah `lineageKey` — murni, tanpa DB.
 *
 * ### Kenapa `split("#")[0]` salah
 *
 * `lineageKey` BUKAN path yang boleh dipotong di tanda `#`. Tanda itu memikul
 * DUA arti sekaligus: pemisah jenjang (`I#6.1#a`) **dan** sufiks pembeda kode
 * kembar (`VI#2` = kategori romawi "VI" yang KEDUA — nyata di data HPS, lihat
 * `flatten.ts`). Memotong di `#` pertama melebur keduanya:
 *
 * | lineageKey | `split("#")[0]` | kategori yang benar |
 * |------------|-----------------|---------------------|
 * | `I#6.1#a`  | `I` ✓           | `I`                 |
 * | `VI#2`     | `VI` ✗          | `VI#2` (kategori kedua) |
 * | `VI#2#1`   | `VI` ✗          | `VI#2`              |
 * | `VI#3#1`   | `VI` ✗          | `VI#3`              |
 *
 * Akibatnya terukur di blanko KKP: realisasi seluruh kategori kedua dijumlahkan
 * ke subtotal kategori PERTAMA, sementara kolom rencananya — yang memakai
 * pencocokan prefiks yang benar di `rab/import.ts` — tetap di kategori kedua.
 * Satu halaman memuat rencana dan realisasi di baris yang berbeda.
 * Audit 2026-09-15 (D-2/G-5).
 *
 * ### Aturannya
 *
 * Kategori sebuah node = **kunci kategori terpanjang** yang sama persis dengan
 * lineageKey-nya, atau yang menjadi awalannya DENGAN batas `#`. Batas itu yang
 * membuat `VI` tidak pernah menyambar `VII#1`.
 */

/** Kunci kategori terpanjang yang memuat `lineageKey`, atau `null`. */
export function kategoriDariLineage(
  lineageKey: string,
  kategoriKeys: Iterable<string>,
): string | null {
  let terbaik: string | null = null;
  for (const k of kategoriKeys) {
    if (lineageKey !== k && !lineageKey.startsWith(`${k}#`)) continue;
    if (terbaik === null || k.length > terbaik.length) terbaik = k;
  }
  return terbaik;
}

/**
 * Versi yang selalu menjawab: jatuh ke segmen pertama bila tidak ada kategori
 * yang cocok (mis. item yatim pada revisi yang kategorinya belum lengkap).
 *
 * Fallback-nya sengaja segmen pertama, bukan lineageKey utuh: yang dicari di
 * situ label untuk baris "PEKERJAAN LAIN-LAIN", dan mengelompokkannya per
 * segmen pertama masih lebih berguna daripada satu baris per item.
 */
export function kategoriDariLineageAtau(
  lineageKey: string,
  kategoriKeys: Iterable<string>,
): string {
  return kategoriDariLineage(lineageKey, kategoriKeys) ?? lineageKey.split("#")[0];
}
