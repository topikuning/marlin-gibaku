/**
 * Titik %-kumulatif untuk editor "Penyesuaian halus" (DECISIONS 775).
 *
 * Barisnya mengikuti jumlah minggu kontrak YANG BERLAKU (termasuk adendum
 * waktu, 773), bukan jumlah titik baseline aktif. Minggu tambahan diisi nilai
 * minggu terakhir – kurva mendatar – sampai orang mengisinya. Kontrak yang
 * lebih pendek TIDAK memotong titik: membuang rencana adalah keputusan orang.
 */
export function titikUntukEditor(titik: number[], mingguKontrak: number): { titik: number[]; tambahan: number } {
  const tambahan = titik.length > 0 ? Math.max(0, mingguKontrak - titik.length) : 0;
  if (tambahan === 0) return { titik, tambahan: 0 };
  const akhir = titik[titik.length - 1]!;
  return { titik: [...titik, ...Array.from({ length: tambahan }, () => akhir)], tambahan };
}
