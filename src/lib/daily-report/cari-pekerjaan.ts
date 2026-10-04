/**
 * Pencarian pekerjaan di input pelaksanaan harian (DECISIONS 648).
 *
 * Semua kata yang diketik harus ada, urutannya bebas ("bekesting kolom
 * praktis" = "praktis bekesting"). `total` selalu jumlah SEMUA yang cocok,
 * supaya layar bisa mengatakan "menampilkan 25 dari 63" alih-alih memotong
 * diam-diam. `batas = null` → tampilkan semua.
 */
export function cariPekerjaan<T extends { code: string; name: string; category: string; subPath: string }>(
  daftar: T[],
  query: string,
  batas: number | null,
): { tampil: T[]; total: number } {
  const kata = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return { tampil: [], total: 0 };
  const cocok = daftar.filter((n) => {
    const teks = `${n.code} ${n.name} ${n.category} ${n.subPath}`.toLowerCase();
    return kata.every((k) => teks.includes(k));
  });
  return { tampil: batas === null ? cocok : cocok.slice(0, batas), total: cocok.length };
}
