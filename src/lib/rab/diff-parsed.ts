import type { FlatNode } from "@/lib/rab/flatten";

/**
 * Bandingkan RAB hasil parse file dengan RAB AKTIF — untuk pratinjau impor
 * (DECISIONS 209). MURNI: tanpa DB, supaya bisa diuji tanpa env.
 *
 * Ini BUKAN `diffRevisions` (yang membandingkan dua revisi tersimpan). Di sini
 * sisi kanan belum tersimpan sama sekali — justru itu gunanya: user melihat
 * apa yang akan berubah SEBELUM ada yang ditulis.
 *
 * Identitas item = `lineageKey` (bukan nama), sama seperti yang dipakai
 * laporan harian. Itu sebabnya "item hilang" bisa dihitung bersama realisasi
 * yang sudah menempel padanya: item yang sudah dikerjakan tapi tidak ada di
 * file baru adalah kejadian paling mahal dalam impor — progresnya lepas.
 */

export type NodeAktif = {
  lineageKey: string;
  kind: string;
  code: string;
  name: string;
  volume: number | null;
  amount: bigint;
};

export type BarisBeda = {
  lineageKey: string;
  code: string;
  name: string;
};

export type VolumeBerubah = BarisBeda & {
  dari: number | null;
  ke: number | null;
  /** Volume yang SUDAH dilaporkan untuk item ini. */
  realisasi: number;
  /** Volume baru di bawah yang sudah terealisasi — mustahil dipertanggungjawabkan. */
  dibawahRealisasi: boolean;
};

export type ItemHilang = BarisBeda & { realisasi: number };

export type RingkasBeda = {
  totalAktif: bigint;
  totalBaru: bigint;
  itemBaru: BarisBeda[];
  itemHilang: ItemHilang[];
  volumeBerubah: VolumeBerubah[];
  /** Item yang lineage-nya sama dan volumenya tidak berubah. */
  jumlahTetap: number;
};

const EPS = 1e-6;

export function bandingkanTerhadapAktif(
  aktif: NodeAktif[],
  baru: FlatNode[],
  realisasiByLineage: Map<string, number>,
): RingkasBeda {
  const itemAktif = new Map(aktif.filter((n) => n.kind === "item").map((n) => [n.lineageKey, n]));
  const itemBaruList = baru.filter((n) => n.kind === "item");
  const itemBaruMap = new Map(itemBaruList.map((n) => [n.lineageKey, n]));

  const itemBaru: BarisBeda[] = [];
  const volumeBerubah: VolumeBerubah[] = [];
  let jumlahTetap = 0;

  for (const n of itemBaruList) {
    const lama = itemAktif.get(n.lineageKey);
    if (!lama) {
      itemBaru.push({ lineageKey: n.lineageKey, code: n.code, name: n.name });
      continue;
    }
    const dari = lama.volume;
    const ke = n.volume;
    const sama = dari == null && ke == null ? true : dari != null && ke != null && Math.abs(dari - ke) < EPS;
    if (sama) {
      jumlahTetap++;
      continue;
    }
    const realisasi = realisasiByLineage.get(n.lineageKey) ?? 0;
    volumeBerubah.push({
      lineageKey: n.lineageKey,
      code: n.code,
      name: n.name,
      dari,
      ke,
      realisasi,
      // Volume kontrak di bawah yang sudah dikerjakan = ada pekerjaan yang tak
      // punya dasar bayar. Ditandai, tidak dibetulkan sendiri.
      dibawahRealisasi: ke != null && realisasi - ke > EPS,
    });
  }

  const itemHilang: ItemHilang[] = [];
  for (const [key, lama] of itemAktif) {
    if (itemBaruMap.has(key)) continue;
    itemHilang.push({
      lineageKey: key,
      code: lama.code,
      name: lama.name,
      realisasi: realisasiByLineage.get(key) ?? 0,
    });
  }
  // Yang sudah dikerjakan disebut LEBIH DULU — itu yang paling perlu dilihat.
  itemHilang.sort((a, b) => b.realisasi - a.realisasi || a.code.localeCompare(b.code, "id"));

  const jumlah = (ns: { kind: string; amount: bigint }[]) =>
    ns.filter((n) => n.kind === "kategori").reduce((t, n) => t + n.amount, 0n);

  return {
    totalAktif: jumlah(aktif),
    totalBaru: jumlah(baru),
    itemBaru,
    itemHilang,
    volumeBerubah,
    jumlahTetap,
  };
}
