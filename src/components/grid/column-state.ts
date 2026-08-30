import type { ColumnState } from "ag-grid-community";

/**
 * Mendamaikan layout kolom yang DISIMPAN peramban dengan kolom yang ADA
 * SEKARANG di kode.
 *
 * `MarlinGrid` menyimpan `getColumnState()` per `persistKey` supaya lebar,
 * urutan, sortir, dan kolom yang disembunyikan bertahan antar kunjungan. Yang
 * tidak diperhitungkan versi pertama: susunan kolomnya berubah karena KODE
 * berubah, bukan karena penggunanya.
 *
 * Saat itu terjadi, `applyColumnState({ applyOrder: true })` merugikan.
 * AG Grid (`orderLiveColsLikeState`) menyusun ulang kolom mengikuti daftar
 * tersimpan, lalu menempelkan kolom yang TIDAK dikenal daftar itu di UJUNG
 * KANAN. Kolom yang baru ditambahkan kodenya karena itu mendarat di seberang
 * tepi gulir — bukan di posisi yang dipilih penulisnya. Di layar "Kebutuhan &
 * harga" itu berarti tiga kolom draf harga AI tak terlihat oleh siapa pun yang
 * pernah membuka layar itu sebelumnya, tanpa satu pun tanda bahwa ada yang
 * disembunyikan.
 *
 * Aturannya: begitu ADA kolom sekarang yang tidak dikenal simpanan, urutan
 * simpanan dilepas dan urutan kode yang dipakai. Lebar dan sortir milik
 * pengguna tetap dipulihkan — yang diambil hanya keputusan yang memang bukan
 * miliknya lagi. Kolom yang DIHAPUS kode tidak menimbulkan masalah apa pun
 * (AG Grid mengabaikan state tanpa kolom), jadi ia tidak membatalkan urutan.
 */
export type SimpananKolom = {
  state: ColumnState[];
  /** false = urutan kode yang dipakai, karena tabelnya berganti bentuk. */
  applyOrder: boolean;
};

/** Bentuk yang ditulis ke localStorage — sengaja tetap `ColumnState[]` polos. */
export function tulisSimpananKolom(state: ColumnState[]): string {
  return JSON.stringify(state);
}

export function bacaSimpananKolom(
  raw: string | null,
  kolomSekarang: string[],
): SimpananKolom | null {
  if (!raw) return null;

  let terurai: unknown;
  try {
    terurai = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(terurai)) return null;

  const tersimpan = terurai as ColumnState[];
  /*
   * `pinned` DIBUANG. Kolom yang dikunci selalu mengikuti kode, bukan simpanan
   * peramban: `getColumnState()` ikut menyimpan `pinned: null` untuk kolom yang
   * saat itu belum dikunci, sehingga siapa pun yang pernah membuka daftar
   * sebelum kuncinya dipasang akan membawa "tidak terkunci" selamanya — dan
   * tidak ada tombol yang bisa menjelaskan bedanya dengan layar orang lain.
   */
  const state = tersimpan
    .filter((k): k is ColumnState => !!k && typeof k === "object" && typeof k.colId === "string")
    .map(({ pinned: _abaikan, ...sisa }) => sisa);
  if (state.length === 0) return null;

  const dikenal = new Set(state.map((k) => k.colId));
  const adaKolomBaru = kolomSekarang.some((id) => !dikenal.has(id));

  return { state, applyOrder: !adaKolomBaru };
}
