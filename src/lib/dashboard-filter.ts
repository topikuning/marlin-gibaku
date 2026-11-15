/**
 * Warna & filter peta Dashboard Eksekutif — modul MURNI (tanpa server-only,
 * tanpa DB) supaya aturannya bisa diuji langsung.
 *
 * DUA FAKTA, DUA TANDA (DECISIONS 770). Keluhan user 2026-11-15: *"permainan
 * warna ini membingungkan. seharusnya warna utama adalah terhadap proyek itu
 * sendiri, baru lingkaran diluarnya itu mencerminkan sudah lapor atau belum"*.
 * - ISI titik = kondisi proyek (`toneKondisi`, dari deviasi saja);
 * - CINCIN titik = laporan hari ini (`cincinBelumLapor`, dari status lapor saja).
 *
 * Dulu (DECISIONS 235) satu warna memampatkan keduanya dan merah menang: lokasi
 * terlambat yang belum lapor tampil abu, dan merah tidak berkata apa pun soal
 * lapor. Status lapor tetap punya sumbernya sendiri (`StatusLapor`) dan tidak
 * pernah diturunkan dari warna.
 */

/**
 * Kondisi proyek. "neutral" = berjalan tapi belum ada angka progres;
 * "idle" = lokasi TARGET (belum mulai). Tidak ada tone "belum lapor".
 */
export type MarkerTone = "success" | "warning" | "danger" | "neutral" | "idle";

/** Deviasi (pp) di BAWAH angka ini = kritis, butuh tindakan segera. */
export const AMBANG_KRITIS_PP = -10;

/** Warna isi titik: hanya dari deviasi, tidak pernah dari status lapor. */
export function toneKondisi(l: { aktif: boolean; deviasiPct: number | null }): MarkerTone {
  if (!l.aktif) return "idle";
  if (l.deviasiPct == null) return "neutral";
  if (l.deviasiPct < AMBANG_KRITIS_PP) return "danger";
  if (l.deviasiPct < 0) return "warning";
  return "success";
}

/** Cincin tebal = lokasi berjalan yang belum lapor hari ini. Belum mulai tidak ditagih. */
export function cincinBelumLapor(lapor: StatusLapor | undefined): boolean {
  return lapor === "belum";
}

/** Status lapor hari ini — terpisah dari warna, sengaja. */
export type StatusLapor = "sudah" | "belum" | "belum_mulai";

export type FilterPeta = "semua" | "submit" | "belum" | "kritis";

export function cocokFilter(filter: FilterPeta, tone: MarkerTone, lapor: StatusLapor): boolean {
  switch (filter) {
    case "semua":
      return true;
    // "belum" hanya untuk lokasi BERJALAN — lokasi yang belum mulai tidak
    // diminta lapor hari ini, jadi bukan tunggakan.
    case "belum":
      return lapor === "belum";
    case "submit":
      return lapor === "sudah";
    case "kritis":
      return tone === "danger";
  }
}
