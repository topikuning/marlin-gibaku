import type { LocationStatus } from "@/generated/prisma/enums";

/**
 * LOKASI "TERTUTUP" – modul murni (DECISIONS 750).
 *
 * Permintaan user 2026-11-08: *"untuk lokasi-lokasi yang sudah dicabut atau
 * dibatalkan tidak perlu dimunculkan di list lokasi, kecuali memang diminta
 * untuk memunculkan"*.
 *
 * Tiga sebab, satu tempat:
 * - **dicabut** – dikeluarkan dari kontrak lewat adendum (`lingkupLokasi`,
 *   DECISIONS 616), tanggal berlakunya sudah lewat;
 * - **batal** – status lokasinya Batal, ATAU paketnya Batal (lokasi di paket
 *   yang dibatalkan ikut batal, walau statusnya sendiri tidak pernah diubah).
 *
 * Disembunyikan, bukan dihapus: laporannya yang lampau tetap ada dan tetap bisa
 * dibuka lewat "tampilkan semua". Yang disembunyikan selalu DIHITUNG per sebab,
 * supaya "tidak muncul" tidak terbaca "tidak ada" (CLAUDE.md).
 */

export type AlasanTertutup = "dicabut" | "batal";

export function alasanTertutup(l: {
  status: LocationStatus;
  paketBatal: boolean;
  dicabut: boolean;
}): AlasanTertutup | null {
  // Dicabut lebih dulu: "dicabut adendum CCO-2" lebih menjelaskan daripada
  // "batal", dan lokasi yang dicabut lalu diberi status Batal tetap dicabut.
  if (l.dicabut) return "dicabut";
  if (l.status === "batal" || l.paketBatal) return "batal";
  return null;
}

export type RingkasTertutup = { dicabut: number; batal: number; total: number };

export function saringLokasiTertutup<T extends { tertutup: AlasanTertutup | null }>(
  baris: readonly T[],
  tampilSemua: boolean,
): { tampil: T[]; tertutup: RingkasTertutup } {
  const tertutup: RingkasTertutup = { dicabut: 0, batal: 0, total: 0 };
  for (const b of baris) {
    if (!b.tertutup) continue;
    tertutup[b.tertutup] += 1;
    tertutup.total += 1;
  }
  return { tampil: tampilSemua ? [...baris] : baris.filter((b) => !b.tertutup), tertutup };
}

/** Kalimat jumlah yang tersembunyi, mis. "2 dicabut, 1 dibatalkan". */
export function sebutTertutup(t: RingkasTertutup): string {
  return [t.dicabut ? `${t.dicabut} dicabut` : null, t.batal ? `${t.batal} dibatalkan` : null]
    .filter(Boolean)
    .join(", ");
}
