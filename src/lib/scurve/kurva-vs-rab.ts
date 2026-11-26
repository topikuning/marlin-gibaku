/**
 * BARIS KURVA-S vs RAB AKTIF (DECISIONS 794) – murni.
 *
 * Keluhan user 2026-11-26 (Kurva S minggu ke-10 BUYAT TENGAH): *"kenapa kamu
 * sajikan tambatan perahu yang volume jelas 0 … lalu pekerjaan tidak ada judul
 * yang sudah hilang juga kamu munculkan"*, dan *"dulu hal ini tidak pernah
 * terjadi, ketika di rab baru sudah tidak ada ya gak muncul"*.
 *
 * Jadwal tersimpan (baseline) membawa satu baris per kategori sejak dibuat.
 * Sesudah adendum/koreksi, sebagian kategorinya tidak ada lagi di RAB aktif
 * (kategori bayangan parser lama, "judul tidak ada di file") atau bernilai 0
 * (Tambatan Perahu dinolkan CCO). Adendum sengaja tidak mengubah bobot jadwal
 * (DECISIONS 698), jadi:
 *
 * - baris BERBOBOT 0 yang pekerjaannya tidak ada/bernilai 0 di RAB aktif tidak
 *   ditampilkan – tidak satu angka pun berubah;
 * - baris yang MASIH BERBOBOT tetap tampil (bobotnya bagian rencana resmi;
 *   menyembunyikannya membuat rencana tidak berbaris), tetapi ketidakcocokannya
 *   dilaporkan supaya jadwalnya diperbarui – begitu juga pekerjaan RAB aktif
 *   yang belum berjadwal.
 */

const NOL = 0.005;

export type BarisKurva = { lineageKey: string; code: string; name: string; weekly: number[] };
export type KategoriRab = { lineageKey: string; code: string; name: string; amount: bigint };

export type KurvaTakSesuai = {
  /** Berbobot di kurva-S, tetapi tidak ada atau bernilai 0 di RAB aktif. */
  tanpaRab: { name: string; bobot: number }[];
  /** Ada dan bernilai di RAB aktif, tetapi bobotnya 0 di kurva-S. */
  tanpaJadwal: { code: string; name: string; bobotRab: number }[];
};

export function cocokkanKurvaDenganRab(
  baris: readonly BarisKurva[],
  kategori: readonly KategoriRab[],
): { tampil: BarisKurva[]; takSesuai: KurvaTakSesuai | null } {
  const nilai = new Map(kategori.map((k) => [k.lineageKey, k.amount]));
  const total = kategori.reduce((s, k) => s + (k.amount > 0n ? k.amount : 0n), 0n);
  const bobot = (b: BarisKurva) => b.weekly.reduce((s, v) => s + v, 0);
  const diRab = (key: string) => (nilai.get(key) ?? 0n) > 0n;

  const tampil = baris.filter((b) => bobot(b) > NOL || diRab(b.lineageKey));
  const tanpaRab = baris
    .filter((b) => bobot(b) > NOL && !diRab(b.lineageKey))
    .map((b) => ({ name: b.name, bobot: Math.round(bobot(b) * 100) / 100 }));
  const berbobot = new Set(baris.filter((b) => bobot(b) > NOL).map((b) => b.lineageKey));
  const tanpaJadwal = kategori
    .filter((k) => k.amount > 0n && !berbobot.has(k.lineageKey))
    .map((k) => ({
      code: k.code,
      name: k.name,
      bobotRab: total > 0n ? Math.round((Number(k.amount) / Number(total)) * 10_000) / 100 : 0,
    }));
  return {
    tampil,
    takSesuai: tanpaRab.length > 0 || tanpaJadwal.length > 0 ? { tanpaRab, tanpaJadwal } : null,
  };
}
