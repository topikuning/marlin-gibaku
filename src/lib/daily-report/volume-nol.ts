/**
 * BARIS BERVOLUME 0 DI LAPORAN HARIAN (DECISIONS 787). MURNI.
 *
 * User 2026-11-26: *"yang utama itu ketika volume 0, laporan harian yang
 * dicetak muncul atau tidak? kalau muncul itu berantakan, kalau tidak,
 * tampilan di laporan per hari, bedakan saja yang 0 dengan collapse, agar
 * tidak membingungkan."*
 *
 * Baris 0 tetap tersimpan (bisa membawa foto, catatan, atau dipakai Pasangkan
 * realisasi), tetapi tidak dicetak (`itemDicetak` di blanko) dan di layar
 * dilipat di bawah daftar pekerjaan.
 */

const EPS = 0.0005;

export const bervolume = (volume: number) => volume > EPS;

export function pisahVolumeNol<T extends { volumeDone: number }>(items: readonly T[]): { ada: T[]; nol: T[] } {
  const ada: T[] = [];
  const nol: T[] = [];
  for (const it of items) (bervolume(it.volumeDone) ? ada : nol).push(it);
  return { ada, nol };
}
