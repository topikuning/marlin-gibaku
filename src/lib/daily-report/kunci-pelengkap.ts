/**
 * Kunci pemasangan ulang badan form Pelengkap laporan harian – murni.
 *
 * Badan form SENGAJA dipasang ulang saat daftar id baris material/alat
 * berubah, supaya id baris yang baru dibuat server masuk ke input tersembunyi
 * (DECISIONS 304). Jam kerja ikut karena hanya berubah oleh simpan form ini
 * sendiri.
 *
 * Kategori cuaca TIDAK boleh ikut. Tombol "Muat ulang cuaca" mengubahnya
 * tanpa menyimpan isian lain, dan pemasangan ulang mengembalikan kolom tenaga,
 * jam kerja, dan catatan yang belum disimpan ke isi basis data (laporan user
 * 2026-10-10, DECISIONS 663). Pemilih cuaca manual – kalau dinyalakan – diberi
 * kuncinya sendiri, jadi hanya pilihan cuacanya yang menyusul.
 */
export function kunciBadanPelengkap(r: {
  workStart: string | null;
  workEnd: string | null;
  materials: readonly { id: string }[];
  equipment: readonly { id: string }[];
}): string {
  return [r.workStart, r.workEnd, ...r.materials.map((m) => m.id), ...r.equipment.map((e) => e.id)].join("|");
}
