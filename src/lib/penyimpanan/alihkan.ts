/**
 * Respons 302 ke alamat berkas dari `alamatBerkas` (DECISIONS 645).
 *
 * Alamat berkas yang sudah pindah ke arsip Lenovo RELATIF (`/api/berkas/…`)
 * dan dikirim APA ADANYA di header Location: peramban menyusunnya terhadap
 * domain yang ia buka. Jangan menyusunnya di server dengan
 * `new URL(url, req.url)` – di belakang proxy Railway `req.url` adalah alamat
 * dalam server (`https://0.0.0.0:8080`), sehingga dokumen lama di produksi
 * dialihkan ke alamat yang tidak bisa dibuka siapa pun (laporan user
 * 2026-10-08). Alamat R2 sudah mutlak dan tidak berubah.
 *
 * Dijaga `tests/unit/alihkan-berkas.test.ts`.
 */
export function alihkanKeBerkas(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}
