import { normalizeName } from "@/lib/gdrive/classify";

/**
 * NAMA LOKASI KEMBAR DI SATU PAKET.
 *
 * `Location` tidak punya kunci alami yang unik — indeks
 * `@@unique([orgId, province, regency, district, village])` hanya ada di
 * `MasterLocation`. Jadi dua lokasi bernama sama bisa lahir dan hidup
 * berdampingan tanpa satu pun penolakan.
 *
 * Selama keduanya di PAKET berbeda, itu tidak fatal: nama desa yang sama di
 * kabupaten berbeda memang lumrah di Indonesia, dan semua angka MARLIN
 * dijumlahkan lewat `location.id`, bukan lewat nama. Yang tidak bisa bertahan
 * adalah dua nama kembar di SATU paket, karena ada jalur yang memilah
 * berdasarkan nama dan hanya melihat lokasi satu paket:
 *
 *   `matchLocation` (src/lib/gdrive/classify.ts) melekatkan berkas Google
 *   Drive ke lokasi dengan mencocokkan nama desa di jalur folder / nama
 *   berkas, dari daftar `pkg.locations`. Kandidat diurut dari nama terpanjang
 *   lalu YANG PERTAMA COCOK dipakai. Dua nama kembar membuatnya memilih salah
 *   satu tanpa dasar — berkas lapangan lokasi A bisa terarsip di lokasi B,
 *   diam-diam, dengan keyakinan penuh.
 *
 * Karena itu ambangnya diikat persis pada kemampuan pemilah itu: dua nama
 * bentrok bila `normalizeName` keduanya identik. Tidak lebih longgar —
 * "Kedungmutih" dan "Kedung Mutih" memang masih bisa dibedakan `matchLocation`,
 * jadi menolaknya berarti melarang data yang sistemnya sanggup tangani.
 *
 * Perkara terpisah — dua baris untuk SATU desa yang sama (kunci alaminya
 * kembar) — ditangani `cariDuplikat` di `@/lib/master-location/queries`.
 */

/** Kunci pembanding nama. WAJIB sama dengan yang dipakai `matchLocation`. */
export function kunciNamaLokasi(nama: string): string {
  return normalizeName(nama);
}

export type LokasiBernama = { id: string; name: string };

/**
 * Lokasi di `kandidat` yang namanya bentrok dengan `nama`.
 * `kecualiId` untuk mengabaikan lokasi itu sendiri (mis. saat ganti nama).
 */
export function namaKembarDi<T extends LokasiBernama>(
  nama: string,
  kandidat: readonly T[],
  kecualiId?: string,
): T[] {
  const k = kunciNamaLokasi(nama);
  if (!k) return [];
  return kandidat.filter((l) => l.id !== kecualiId && kunciNamaLokasi(l.name) === k);
}

export type KelompokKembar<T extends LokasiBernama> = {
  /** Nama ternormalkan yang membuat mereka bentrok. */
  kunci: string;
  anggota: T[];
};

/**
 * Kelompokkan lokasi yang namanya kembar. Hanya kelompok berisi ≥2 yang
 * dikembalikan — sisanya bukan masalah.
 */
export function kelompokNamaKembar<T extends LokasiBernama>(
  lokasi: readonly T[],
): KelompokKembar<T>[] {
  const byKunci = new Map<string, T[]>();
  for (const l of lokasi) {
    const k = kunciNamaLokasi(l.name);
    if (!k) continue;
    const arr = byKunci.get(k);
    if (arr) arr.push(l);
    else byKunci.set(k, [l]);
  }
  return [...byKunci.entries()]
    .filter(([, anggota]) => anggota.length > 1)
    .map(([kunci, anggota]) => ({ kunci, anggota }))
    .sort((a, b) => a.kunci.localeCompare(b.kunci));
}
