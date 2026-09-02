/**
 * SATU pembaca angka untuk seluruh jalur impor Excel — murni, tanpa DB.
 *
 * ### Kenapa harus satu
 *
 * Audit 2026-09-01 menemukan dua parser di repo yang sama memakai konvensi
 * desimal yang BERLAWANAN pada sel yang sama:
 *
 * | teks di sel     | `hps-parser.num()` lama | `adendum-template-parse.angka()` lama |
 * |-----------------|-------------------------|----------------------------------------|
 * | `1.500.000,50`  | **null** (baris hilang) | 1500000,5 ✓                            |
 * | `12.5`          | 12,5 ✓                  | **125** (sepuluh kali lipat)           |
 * | `1,5`           | **15** (sepuluh kali)   | 1,5 ✓                                  |
 * | `Rp 1.500.000`  | **null**                | 1500000 ✓                              |
 *
 * `num()` membuang semua koma lalu memperlakukan titik sebagai desimal;
 * `angka()` membuang semua titik lalu memperlakukan koma sebagai desimal.
 * Sel teks bukan hal langka: kolom ber-format Text, atau angka yang ditempel
 * dari PDF/Word, tersimpan sebagai string.
 *
 * ### Aturannya sengaja TIDAK menebak
 *
 * Yang paling berbahaya di sini adalah salah menebak `1.500` — 1,5 atau 1500?
 * Volume `Decimal(15,3)` membuat tiga desimal lazim (`3.333` m³), sementara
 * pemisah ribuan Indonesia membuat `1.500` juga lazim berarti seribu lima
 * ratus. Menebak salah mengalikan atau membagi angka orang dengan 1000 tanpa
 * suara — persis kelas kesalahan yang sedang diperbaiki.
 *
 * Jadi hanya yang PASTI yang ditafsirkan:
 *
 * 1. Ada koma → koma pasti desimal (Indonesia), titik pasti pemisah ribuan.
 * 2. Tanpa koma, DUA titik atau lebih → semua titik pasti pemisah ribuan;
 *    sebuah bilangan tidak mungkin punya dua tanda desimal.
 * 3. Tanpa koma, SATU titik → dibiarkan sebagai desimal. Ini sengaja sama
 *    dengan perilaku `num()` lama, supaya tidak ada berkas yang angkanya
 *    berubah diam-diam oleh perbaikan ini. Ambiguitasnya nyata dan diakui;
 *    yang tidak boleh adalah menyelesaikannya dengan tebakan.
 *
 * ### Yang tidak dikenali menjadi `null`, bukan 0
 *
 * `Number("")` adalah `0`. `angka()` lama membiarkan itu lolos, sehingga sel
 * `#REF!`, rumus tanpa hasil ter-cache, spasi, `"n/a"`, `"TBD"`, dan objek
 * richText semuanya menjadi **volume 0** tanpa satu pun galat — pekerjaan
 * bernilai ratusan juta lenyap diam-diam. Di sini semua itu `null`, dan
 * pemanggilnya yang memutuskan apa artinya baris tanpa angka.
 */

/** Sel yang tidak berisi angka yang bisa dipercaya → `null`, TIDAK PERNAH 0. */
export function bacaAngkaLokal(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return null;
  if (v instanceof Date) return null; // sel tanggal bukan angka pekerjaan

  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Sel rumus ExcelJS: hasilnya ter-cache di `result`. Tanpa cache → null,
    // bukan 0: berkas yang rumusnya belum pernah dihitung tidak boleh
    // menghasilkan angka.
    if ("result" in o) return bacaAngkaLokal(o.result);
    // richText / hyperlink: ambil teksnya kalau ada, jangan paksakan.
    if ("text" in o && typeof o.text === "string") return bacaAngkaLokal(o.text);
    if ("richText" in o && Array.isArray(o.richText)) {
      return bacaAngkaLokal(o.richText.map((r) => (r as { text?: string }).text ?? "").join(""));
    }
    if ("error" in o) return null; // #REF!, #VALUE!, #DIV/0!
    return null;
  }

  const mentah = String(v).trim();
  if (!/\d/.test(mentah)) return null; // "-", "n/a", "TBD", "" → bukan angka

  // Hanya digit, pemisah, dan tanda minus di depan yang dipertahankan.
  const negatif = /^\s*[-(]/.test(mentah);
  let t = mentah.replace(/[^\d.,]/g, "");
  if (!t) return null;

  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if ((t.match(/\./g) ?? []).length >= 2) {
    t = t.replace(/\./g, "");
  }

  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negatif ? -n : n;
}
