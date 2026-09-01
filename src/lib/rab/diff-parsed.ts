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
  unitPrice: number | null;
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

/**
 * Harga satuan item KONTRAK LAMA yang berubah di file baru (DECISIONS 213).
 *
 * Adendum mengubah VOLUME; harga satuan item yang sudah ada di kontrak adalah
 * harga yang sudah disepakati dan tidak boleh bergeser. Kalau bergeser, nilai
 * kontrak berubah tanpa ada pekerjaan yang bertambah — dan itu tidak akan
 * terlihat di kolom volume mana pun. Item BARU tidak masuk sini: harganya
 * memang belum pernah disepakati.
 */
export type HargaBerubah = BarisBeda & {
  /**
   * Nama item yang sama di KONTRAK. Wajib dibawa: panel lama mencetak nama dari
   * file baru bersama harga dari item lama, jadi pasangan yang meleset (nomor
   * bergeser) terbaca sebagai "harga berubah" dan tidak ada cara melihatnya.
   */
  namaLama: string;
  dari: number | null;
  ke: number | null;
  /** Volume kontrak baru — dipakai menaksir dampak rupiahnya. */
  volume: number | null;
  /** (harga baru − harga lama) × volume baru, dibulatkan ke rupiah. */
  dampakRupiah: bigint;
};

export type RingkasBeda = {
  totalAktif: bigint;
  totalBaru: bigint;
  itemBaru: BarisBeda[];
  itemHilang: ItemHilang[];
  volumeBerubah: VolumeBerubah[];
  hargaBerubah: HargaBerubah[];
  /** Item yang lineage-nya sama, volume DAN harga satuannya tidak berubah. */
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
  const hargaBerubah: HargaBerubah[] = [];
  let jumlahTetap = 0;

  for (const n of itemBaruList) {
    const lama = itemAktif.get(n.lineageKey);
    if (!lama) {
      itemBaru.push({ lineageKey: n.lineageKey, code: n.code, name: n.name });
      continue;
    }
    const dari = lama.volume;
    const ke = n.volume;
    const volumeSama = dari == null && ke == null ? true : dari != null && ke != null && Math.abs(dari - ke) < EPS;

    // Harga satuan diperiksa TERPISAH dari volume: item bisa volumenya tetap
    // tapi harganya bergeser, dan itu justru yang paling mudah lolos.
    // Toleransi 0,005 = setengah rupiah-sen; di bawah itu beda pembulatan tulis
    // dari dokumen, bukan perubahan harga.
    const hargaLama = lama.unitPrice;
    const hargaBaruNilai = n.unitPrice;
    const hargaSama =
      hargaLama == null && hargaBaruNilai == null
        ? true
        : hargaLama != null && hargaBaruNilai != null && Math.abs(hargaLama - hargaBaruNilai) < 0.005;
    if (!hargaSama) {
      hargaBerubah.push({
        lineageKey: n.lineageKey,
        code: n.code,
        name: n.name,
        namaLama: lama.name,
        dari: hargaLama,
        ke: hargaBaruNilai,
        volume: ke,
        dampakRupiah: BigInt(Math.round(((hargaBaruNilai ?? 0) - (hargaLama ?? 0)) * (ke ?? 0))),
      });
    }

    if (volumeSama) {
      if (hargaSama) jumlahTetap++;
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
  // Dampak rupiah terbesar disebut lebih dulu.
  hargaBerubah.sort((a, b) => {
    const av = a.dampakRupiah < 0n ? -a.dampakRupiah : a.dampakRupiah;
    const bv = b.dampakRupiah < 0n ? -b.dampakRupiah : b.dampakRupiah;
    return bv > av ? 1 : bv < av ? -1 : a.code.localeCompare(b.code, "id");
  });

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
    hargaBerubah,
    jumlahTetap,
  };
}
