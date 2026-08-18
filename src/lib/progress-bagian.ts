/**
 * BAGIAN halaman Progress lokasi — murni, tanpa DB (DECISIONS 363).
 *
 * Halaman ini sebelumnya menumpuk delapan kartu: kurva-S, tabel mingguan,
 * prognosa, editor jadwal, penyesuaian halus, item tertinggal, kendala, dan
 * riwayat baseline. Dua peran yang sangat berbeda dijejalkan ke satu gulungan —
 * **memantau** (baca angka) dan **mengatur** (ubah baseline/jadwal) — sehingga
 * orang yang cuma ingin melihat deviasi harus melewati editor, dan orang yang
 * mau memperbarui kurva-S harus mencari tempatnya jauh di bawah grafik.
 */

import { bacaSubTab, hrefSubTab } from "@/lib/ui/sub-tab";

export type BagianProgress = "ringkasan" | "baseline" | "jadwal" | "kendala";

export const BAGIAN_PROGRESS: readonly BagianProgress[] = [
  "ringkasan",
  "baseline",
  "jadwal",
  "kendala",
];

/** Default `"ringkasan"`: memantau jauh lebih sering daripada mengatur. */
export function bacaBagianProgress(v: string | undefined | null): BagianProgress {
  return bacaSubTab(BAGIAN_PROGRESS, v, "ringkasan");
}

export function hrefBagianProgress(slug: string, bagian: BagianProgress): string {
  return hrefSubTab(`/lokasi/${slug}/progress`, bagian);
}
