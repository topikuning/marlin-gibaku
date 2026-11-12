import { ttdHarianBoleh } from "@/lib/lifecycle";

/**
 * SATU PINTU tanda tangan & stempel laporan harian (DECISIONS 760).
 *
 * Gambar baru dimuat bila laporannya `disetujui` atau `final`; status lain
 * mendapat `kosong` – ruang tanda tangan untuk pena, persis cetakan tanpa
 * gambar. Dipakai halaman cetak, PDF harian, rekap harian seminggu, dan Excel
 * harian WA. `tests/unit/ttd-harian-status.test.ts` menjaga tidak ada jalur
 * yang memuat tanda tangan harian di luar pintu ini.
 */
export async function ttdHarian<T>(status: string | null | undefined, muat: () => Promise<T>, kosong: T): Promise<T> {
  return ttdHarianBoleh(status) ? muat() : kosong;
}
