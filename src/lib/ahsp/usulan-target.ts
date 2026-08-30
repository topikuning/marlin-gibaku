/**
 * Memilih sumber daya mana yang dimintakan draf harga kepada AI. MURNI.
 *
 * Bukan formula angka — tidak ada rupiah yang lahir di sini, hanya URUTAN
 * pekerjaan. Karena itu ia tidak masuk daftar calculation layer PROJECT.md §3.
 */

export const BATAS_USULAN_HARGA_AI = 25;

export type BarisTarget = {
  kategori: string;
  nama: string;
  satuan: string;
  /** null = belum berharga; hanya yang null yang boleh dimintakan draf. */
  harga: bigint | null;
  /** Nilai RAB item-item yang membutuhkan sumber daya ini (rapl-calc.ts). */
  nilaiTertahan: bigint;
};

export type HasilPilihTarget<T> = {
  /** Yang dikirim ke AI, paling banyak `batas`. */
  target: T[];
  /** Berapa sumber daya yang belum berharga SELURUHNYA. */
  totalKosong: number;
  /** Yang tidak ikut dimintakan kali ini. `totalKosong - target.length`. */
  tidakDiminta: number;
};

/**
 * Urutan kategori dipakai HANYA sebagai pemutus seri, bukan pengurut utama.
 * Versi pertama menjadikannya pengurut utama, dan itulah yang membuat kuota
 * habis untuk upah sebelum satu pun bahan besar kebagian.
 */
const URUTAN_KATEGORI: Record<string, number> = { upah: 0, bahan: 1, alat: 2, fasilitas: 3 };

/** Kunci sumber daya untuk pemilihan — sebentuk dengan `kunciSumberDaya`. */
export function kunciTarget(b: { kategori: string; nama: string; satuan: string }): string {
  return JSON.stringify([b.kategori, b.nama, b.satuan.trim().toLowerCase()]);
}

export function pilihTargetUsulan<T extends BarisTarget>(
  baris: T[],
  batas: number = BATAS_USULAN_HARGA_AI,
  /** Kunci yang DICENTANG pengguna sendiri; bila ada, ia yang menentukan. */
  dipilih?: ReadonlySet<string>,
): HasilPilihTarget<T> {
  const kosong = baris.filter((b) => b.harga === null);
  const kandidat =
    dipilih && dipilih.size > 0 ? kosong.filter((b) => dipilih.has(kunciTarget(b))) : kosong;

  /*
   * Diurut dari NILAI RAB YANG TERTAHAN — bukan dari kuantitas, bukan dari
   * urutan tampil. Mengisi harga adalah pekerjaan yang tidak selesai sekaligus;
   * yang menentukan berguna-tidaknya satu panggilan adalah apakah 25 pertama
   * menutup sebagian besar nilai proyek.
   *
   * Pemutus serinya deterministik sampai ke satuan, supaya dua panggilan atas
   * data yang sama tidak pernah mengirim daftar berbeda.
   */
  const target = [...kandidat]
    .sort(
      (a, b) =>
        (b.nilaiTertahan > a.nilaiTertahan ? 1 : b.nilaiTertahan < a.nilaiTertahan ? -1 : 0) ||
        (URUTAN_KATEGORI[a.kategori] ?? 9) - (URUTAN_KATEGORI[b.kategori] ?? 9) ||
        a.nama.localeCompare(b.nama, "id") ||
        a.satuan.localeCompare(b.satuan, "id"),
    )
    .slice(0, Math.max(0, batas));

  return {
    target,
    totalKosong: kosong.length,
    tidakDiminta: kosong.length - target.length,
  };
}
