/**
 * Filter peta Dashboard Eksekutif — modul MURNI (tanpa server-only, tanpa DB)
 * supaya aturannya bisa diuji langsung.
 *
 * Alasan modul ini ada: filternya dulu menyimpulkan status lapor dari WARNA
 * pin. Warna memampatkan dua fakta — sudah/belum lapor DAN deviasi — dan
 * deviasi kritis sengaja menang (keputusan user 2026-08-03). Akibatnya lokasi
 * yang belum lapor tapi kritis berwarna merah, sehingga:
 *   · "Belum Submit" (dulu = pin abu saja) MENGHILANGKAN lokasi itu,
 *   · "Sudah Submit" (dulu = hijau/oranye/merah) justru MENARIKNYA MASUK.
 * Petanya jadi berselisih dengan kartu KPI tepat di atasnya.
 *
 * Karena itu status lapor punya sumbernya sendiri (`StatusLapor`) dan tidak
 * boleh diturunkan dari `MarkerTone`.
 */

/** "idle" = lokasi TARGET (belum mulai) — bukan "belum lapor hari ini". */
export type MarkerTone = "success" | "warning" | "danger" | "neutral" | "idle";

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
