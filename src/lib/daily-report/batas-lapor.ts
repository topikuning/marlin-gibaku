import { VOLUME_EPSILON } from "./constants";

/**
 * BATAS VOLUME LAPORAN HARIAN bila draft adendum menaikkan volume item kontrak
 * (DECISIONS 742). Murni – dipakai form laporan harian dan WA lapor; penjaga
 * yang menentukan tetap `upsertItem`.
 *
 * Satu baris laporan per item per hari (`@@unique([reportId, lineageKey])`),
 * jadi volume SATU hari tidak bisa dipecah ke dua basis:
 *  - ≤ sisa kontrak → dicatat terhadap RAB kontrak (resmi);
 *  - > sisa kontrak dan ≤ sisa menurut draft → SELURUHNYA dicatat terhadap
 *    draft adendum (belum resmi; ikut resmi saat adendum diaktifkan, 210);
 *  - > sisa draft → ditolak.
 */
export type SisaPilihan = {
  /** Sisa terhadap RAB kontrak (null = item tanpa volume, tidak dibatasi). */
  remaining: number | null;
  /**
   * Sisa menurut draft adendum = volume draft − realisasi SEMUA basis. Hanya
   * ada bila draft menaikkan volume item kontrak ini.
   */
  sisaDraft?: number | null;
};

/** Volume terbesar yang masih bisa dilaporkan hari ini untuk pilihan ini. */
export function batasLapor(o: SisaPilihan): number | null {
  if (o.remaining == null) return null;
  return o.sisaDraft != null ? Math.max(o.remaining, o.sisaDraft) : o.remaining;
}

/** Volume `v` akan dicatat terhadap draft adendum, bukan RAB kontrak? */
export function keDraftAdendum(o: SisaPilihan, v: number): boolean {
  if (o.remaining == null || o.sisaDraft == null) return false;
  return v > o.remaining + VOLUME_EPSILON && v <= o.sisaDraft + VOLUME_EPSILON;
}
