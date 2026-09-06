/**
 * PENCARIAN LOKASI PADA PENUGASAN PENGGUNA.
 *
 * Permintaan user 2026-09-06: *"mapping lokasi untuk pengguna, searchnya juga
 * harusnya bisa kabupaten atau perusahaan, jangan saklek nama desa/lokasi."*
 *
 * Dipisah dari komponennya supaya bisa diuji apa adanya: aturan "kata mana yang
 * dianggap cocok" menentukan siapa mendapat akses ke lokasi mana, dan itu
 * terlalu penting untuk hanya hidup di dalam JSX.
 *
 * Aturannya sederhana dan sengaja longgar: setiap kata yang diketik harus ada
 * di SALAH SATU keterangan lokasi (nama, perusahaan, wilayah, paket). Dua kata
 * berarti keduanya harus cocok — "rembang cv" menyaring lebih tajam, bukan
 * lebih luas — supaya mengetik lebih banyak selalu berarti hasil lebih sedikit.
 */
export type LokasiTercari = {
  name: string;
  company?: string | null;
  /** Desa, kecamatan, kabupaten, provinsi — digabung jadi satu teks. */
  area?: string | null;
  /** Keterangan lain yang ikut dicari tanpa ditampilkan (mis. nama paket). */
  extra?: string | null;
};

export function cocokLokasi(l: LokasiTercari, kueri: string): boolean {
  const kata = kueri.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return true;
  const ladang = [l.name, l.company, l.area, l.extra]
    .filter((v): v is string => !!v)
    .map((v) => v.toLowerCase());
  return kata.every((k) => ladang.some((v) => v.includes(k)));
}
