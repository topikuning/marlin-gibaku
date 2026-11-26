/**
 * BARIS YANG BOLEH DIBUANG IMPOR REKAP HARIAN (DECISIONS 786/787). MURNI.
 *
 * Impor rekap membuang baris yang dinolkannya bila baris itu tidak membawa
 * apa-apa lagi (786). Batasnya (787):
 * - baris 0 yang SUDAH ada hanya dibuang bila terbukti dinolkan impor rekap
 *   sendiri (jejak audit `daily_report.impor_rekap_harian`, aksi `nolkan`).
 *   Baris 0 lain bisa punya arti: baris yang diturunkan saat aktivasi adendum
 *   (745/756) dipakai Pasangkan realisasi (777) untuk memulihkan angkanya;
 * - item yang volume kontraknya 0 di RAB aktif tidak pernah dibuang barisnya –
 *   itu bahan Pasangkan realisasi;
 * - baris yang masih membawa foto, catatan orang, catatan luar RAB, atau hasil
 *   pemasangan tidak dibuang.
 *
 * Baris 0 yang tertinggal tidak perlu dibersihkan lewat impor ulang: blanko
 * cetak tidak memuatnya dan layar harian melipatnya (787).
 */

/** Penanda baris yang dibuat impor ini sendiri – bukan catatan orang. */
export const CATATAN_IMPOR = "Dari impor rekap harian";

const EPS = 0.0005;

/** Kunci (item, tanggal) yang pernah dinolkan impor rekap, dari payload jejak audit. */
export function buktiNolImpor(payloads: readonly unknown[]): Set<string> {
  const bukti = new Set<string>();
  for (const p of payloads) {
    if (!p || typeof p !== "object") continue;
    const { lineageKey, perubahan } = p as { lineageKey?: unknown; perubahan?: unknown };
    if (typeof lineageKey !== "string" || !Array.isArray(perubahan)) continue;
    for (const x of perubahan) {
      if (!x || typeof x !== "object") continue;
      const { tanggal, aksi } = x as { tanggal?: unknown; aksi?: unknown };
      if (aksi === "nolkan" && typeof tanggal === "string") bukti.add(`${lineageKey}@${tanggal}`);
    }
  }
  return bukti;
}

/** Apa yang masih dibawa baris (null = tidak ada). */
export function isiBaris(b: { catatan?: string | null; luarRab?: boolean; padanan: boolean }, fotoSisa: number): string | null {
  const isi: string[] = [];
  if (fotoSisa > 0) isi.push(`${fotoSisa} foto`);
  const cat = b.catatan?.trim();
  if (cat && cat !== CATATAN_IMPOR) isi.push("catatan");
  if (b.luarRab) isi.push("catatan di luar RAB yang dipadankan");
  if (b.padanan) isi.push("hasil pemasangan");
  return isi.length > 0 ? isi.join(", ") : null;
}

/** Item yang volume kontraknya 0 (atau tidak ada) di RAB aktif: barisnya milik Pasangkan realisasi. */
export const kontrakNol = (volumeKontrak: number | null | undefined) => volumeKontrak == null || volumeKontrak <= EPS;
