import { simpulNol } from "@/lib/rab/pohon-nol";

/**
 * ITEM RAB YANG DINOLKAN (DECISIONS 798) – satu definisi, murni.
 *
 * Ketetapan user 2026-11-27: *"intinya aku tidak nyaman ketika rab baru aktif,
 * item yang sudah 0 masih muncul! camkan itu. ketika dia 0, kecuali dalam
 * konteks perbandingan, maka dia tidak muncul sama sekali di laporan."*
 *
 * Item dinolkan = volume kosong atau < 0,0005 (presisi kolom `Decimal(15,3)`)
 * DAN nilainya 0. Barisnya tetap TERSIMPAN – laporan harian lama menunjuk ke
 * sana dan Pasangkan realisasi memakainya (745/756/777) – tetapi tidak muncul
 * di pohon, pemilih pekerjaan, laporan, maupun berkas unduhan. Pengecualiannya
 * hanya layar perbandingan (impor/adendum/bandingkan revisi).
 *
 * Item bervolume 0 yang nilainya TIDAK 0 (lumsum tanpa volume) bukan item
 * dinolkan dan tetap tampil – angkanya masih dihitung.
 *
 * Sebelum ini aturannya tersebar dengan bunyi berbeda (`simpulNol`,
 * `periodic-report`, `suggest`, `jadwal-ai`, `laggingItems`). Pemakai baru
 * memakai fungsi ini.
 */

/** Ambang volume nol: setengah satuan terkecil kolom `Decimal(15,3)`. */
export const AMBANG_VOLUME_NOL = 0.0005;

type Angka = number | string | bigint | { toString(): string } | null | undefined;

const keAngka = (v: Angka): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
};

export function volumeNol(volume: Angka): boolean {
  const v = keAngka(volume);
  return v == null || Math.abs(v) < AMBANG_VOLUME_NOL;
}

/** Item yang dinolkan adendum/CCO: volume ≈ 0 dan nilai 0. */
export function itemDinolkan(n: { volume: Angka; amount: Angka }): boolean {
  return volumeNol(n.volume) && (keAngka(n.amount) ?? 0) === 0;
}

/**
 * Pohon RAB tanpa item yang dinolkan, beserta induk yang SELURUH turunannya
 * dinolkan (kategori Tambatan yang dinolkan CCO ikut hilang). Aturan pohonnya
 * sama dengan pohon RAB di layar (`simpulNol`, 788). Kode kategori yang tersisa
 * tidak dinomori ulang – penomoran tetap milik berkas RAB.
 */
export function tanpaSimpulNol<T extends { id: string; parentId: string | null; volume: Angka; amount: Angka }>(
  nodes: readonly T[],
): T[] {
  const { nol } = simpulNol(
    nodes.map((n) => ({ id: n.id, parentId: n.parentId, volume: keAngka(n.volume), amount: keAngka(n.amount) ?? 0 })),
  );
  return nodes.filter((n) => !nol.has(n.id));
}
