/**
 * SIMPUL RAB BERVOLUME 0 (DECISIONS 788). MURNI.
 *
 * Adendum/CCO menolkan item (Tambatan Perahu BUYAT TENGAH: seluruh kategori
 * Rp 0 di MC0). Item itu tetap tersimpan – laporan harian lamanya menunjuk ke
 * sana dan Pasangkan realisasi memakainya (745/756/777) – tetapi di pohon RAB ia
 * hanya membingungkan (user 2026-11-26: *"item-item yang dihapus atau 0 di RAB
 * aktif malah tetap ada"*). Pohon menyembunyikannya sebagai bawaan, dengan
 * jumlahnya disebut dan satu tombol untuk menampilkannya.
 *
 * Simpul "nol" = daun bervolume 0 (atau kosong) dan bernilai 0, atau induk
 * yang SEMUA turunannya nol.
 */

export type SimpulPohon = { id: string; parentId: string | null; volume: number | null; amount: string | number | bigint };

const nolAngka = (v: number | null) => v == null || Math.abs(v) < 0.0005;

export function simpulNol(nodes: readonly SimpulPohon[]): { nol: Set<string>; daunNol: number } {
  const anak = new Map<string | null, SimpulPohon[]>();
  for (const n of nodes) anak.set(n.parentId, [...(anak.get(n.parentId) ?? []), n]);
  const nol = new Set<string>();
  let daunNol = 0;
  const kunjungi = (n: SimpulPohon, jejak: Set<string>): boolean => {
    if (jejak.has(n.id)) return false; // pohon rusak: anggap tidak nol
    const turunan = anak.get(n.id) ?? [];
    let hasil: boolean;
    if (turunan.length === 0) {
      hasil = nolAngka(n.volume) && Number(n.amount) === 0;
      if (hasil) daunNol++;
    } else {
      const lanjut = new Set(jejak).add(n.id);
      // Kunjungi SEMUA turunan (bukan berhenti di yang pertama) supaya
      // tiap daun nol ikut terhitung.
      hasil = turunan.map((t) => kunjungi(t, lanjut)).every(Boolean);
    }
    if (hasil) nol.add(n.id);
    return hasil;
  };
  for (const akar of anak.get(null) ?? []) kunjungi(akar, new Set());
  return { nol, daunNol };
}
