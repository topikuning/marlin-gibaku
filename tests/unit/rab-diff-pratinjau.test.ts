// Pratinjau perubahan impor terhadap RAB aktif (DECISIONS 209).
//
// Permintaan user 2026-08-02: impor ke draft adendum harus menampilkan diff
// lebih dulu. Yang diuji di sini bukan "ada angka", tapi tiga keadaan yang
// merugikan orang kalau tidak terlihat SEBELUM disimpan:
//   1. pekerjaan yang SUDAH dikerjakan tapi hilang di file baru — realisasinya
//      lepas dari RAB dan progres lokasi turun diam-diam;
//   2. volume kontrak turun DI BAWAH yang sudah dikerjakan — ada pekerjaan
//      tanpa dasar bayar;
//   3. identitas item mengikuti lineageKey, bukan nama — nama yang sama dengan
//      lineage berbeda BUKAN item yang sama.
import { describe, expect, it } from "vitest";
import { bandingkanTerhadapAktif, type NodeAktif } from "@/lib/rab/diff-parsed";
import type { FlatNode } from "@/lib/rab/flatten";

const aktif: NodeAktif[] = [
  { lineageKey: "I", parentLineageKey: null, kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", volume: null, unitPrice: null, amount: 3_000_000n },
  { lineageKey: "I#1", parentLineageKey: "I", kind: "item", code: "1", name: "Galian Tanah", volume: 100, unitPrice: null, amount: 2_000_000n },
  { lineageKey: "I#2", parentLineageKey: "I", kind: "item", code: "2", name: "Papan Nama", volume: 1, unitPrice: null, amount: 1_000_000n },
];

const item = (o: Partial<FlatNode> & Pick<FlatNode, "lineageKey" | "code" | "name">): FlatNode => ({
  kind: "item",
  volume: null,
  unit: null,
  unitPrice: null,
  amount: 0n,
  parentLineageKey: "I",
  sortOrder: 0,
  ...o,
});

const kategori = (amount: bigint): FlatNode => ({
  kind: "kategori",
  code: "I",
  name: "PEKERJAAN PERSIAPAN",
  volume: null,
  unit: null,
  unitPrice: null,
  amount,
  lineageKey: "I",
  parentLineageKey: null,
  sortOrder: 0,
});

describe("KASUS INTI: yang sudah dikerjakan tapi hilang di file baru", () => {
  it("disebut namanya beserta volume yang sudah terealisasi", () => {
    const baru = [kategori(2_000_000n), item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 100 })];
    const h = bandingkanTerhadapAktif(aktif, baru, new Map([["I#2", 1]]));
    expect(h.itemHilang).toEqual([
      { lineageKey: "I#2", code: "2", jalur: "I · 2", name: "Papan Nama", realisasi: 1 },
    ]);
  });

  it("yang sudah dikerjakan diurutkan LEBIH DULU daripada yang belum", () => {
    const dua: NodeAktif[] = [
      ...aktif,
      { lineageKey: "I#3", parentLineageKey: "I", kind: "item", code: "3", name: "Belum Dikerjakan", volume: 5, unitPrice: null, amount: 0n },
    ];
    const baru = [kategori(2_000_000n), item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 100 })];
    const h = bandingkanTerhadapAktif(dua, baru, new Map([["I#2", 1]]));
    expect(h.itemHilang.map((i) => i.code)).toEqual(["2", "3"]);
  });
});

describe("KASUS INTI: volume turun di bawah yang sudah dikerjakan", () => {
  it("ditandai, bukan dibetulkan diam-diam", () => {
    const baru = [
      kategori(3_000_000n),
      item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 40 }),
      item({ lineageKey: "I#2", code: "2", name: "Papan Nama", volume: 1 }),
    ];
    const h = bandingkanTerhadapAktif(aktif, baru, new Map([["I#1", 60]]));
    expect(h.volumeBerubah).toHaveLength(1);
    expect(h.volumeBerubah[0]).toMatchObject({
      code: "1",
      dari: 100,
      ke: 40,
      realisasi: 60,
      dibawahRealisasi: true,
    });
  });

  it("volume turun tapi MASIH di atas realisasi = perubahan biasa", () => {
    const baru = [
      kategori(3_000_000n),
      item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 80 }),
      item({ lineageKey: "I#2", code: "2", name: "Papan Nama", volume: 1 }),
    ];
    const h = bandingkanTerhadapAktif(aktif, baru, new Map([["I#1", 60]]));
    expect(h.volumeBerubah[0].dibawahRealisasi).toBe(false);
  });
});

describe("identitas item = lineageKey, bukan nama", () => {
  it("nama sama + lineage beda = item BARU, bukan perubahan volume", () => {
    const baru = [
      kategori(3_000_000n),
      item({ lineageKey: "I#9", code: "9", name: "Galian Tanah", volume: 100 }),
      item({ lineageKey: "I#2", code: "2", name: "Papan Nama", volume: 1 }),
    ];
    const h = bandingkanTerhadapAktif(aktif, baru, new Map());
    expect(h.itemBaru.map((i) => i.lineageKey)).toEqual(["I#9"]);
    expect(h.itemHilang.map((i) => i.lineageKey)).toEqual(["I#1"]);
    expect(h.volumeBerubah).toHaveLength(0);
  });

  it("item dengan volume sama dihitung 'tetap', tidak dilaporkan sebagai perubahan", () => {
    // `amount` diisi sama dengan kontrak. `flatten` selalu memberi nilai pada
    // item (`total_price ?? volume x harga`), jadi item bernilai 0 di sisi file
    // sementara kontraknya 2 juta bukan "belum diisi" melainkan pergeseran
    // nilai kontrak sebesar 2 juta – dan sejak `nilaiBergeser` ada, itu memang
    // dilaporkan.
    const baru = [
      kategori(3_000_000n),
      item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 100, amount: 2_000_000n }),
      item({ lineageKey: "I#2", code: "2", name: "Papan Nama", volume: 1, amount: 1_000_000n }),
    ];
    const h = bandingkanTerhadapAktif(aktif, baru, new Map());
    expect(h.jumlahTetap).toBe(2);
    expect(h.itemBaru).toHaveLength(0);
    expect(h.itemHilang).toHaveLength(0);
    expect(h.volumeBerubah).toHaveLength(0);
  });
});

describe("nilai total dibandingkan dari kategori, bukan dijumlah ulang dari daun", () => {
  it("total aktif vs total baru diambil apa adanya", () => {
    const baru = [kategori(4_500_000n), item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 150 })];
    const h = bandingkanTerhadapAktif(aktif, baru, new Map());
    expect(h.totalAktif).toBe(3_000_000n);
    expect(h.totalBaru).toBe(4_500_000n);
  });
});

// Harga satuan item kontrak lama TIDAK BOLEH bergeser (DECISIONS 213).
//
// Koreksi user 2026-08-02: "item yang sudah ada sebelum adendum, harga
// satuannya tidak boleh berubah, harus ada warning jika terjadi. berbeda
// dengan item baru." Adendum mengubah VOLUME. Harga yang bergeser mengubah
// nilai kontrak tanpa ada pekerjaan yang bertambah — dan tidak satu pun kolom
// volume memperlihatkannya, jadi ia lolos justru pada file yang volumenya
// tampak wajar.
const berharga: NodeAktif[] = [
  { lineageKey: "I", parentLineageKey: null, kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", volume: null, unitPrice: null, amount: 3_000_000n },
  { lineageKey: "I#1", parentLineageKey: "I", kind: "item", code: "1", name: "Galian Tanah", volume: 100, unitPrice: 20_000, amount: 2_000_000n },
  { lineageKey: "I#2", parentLineageKey: "I", kind: "item", code: "2", name: "Papan Nama", volume: 1, unitPrice: 1_000_000, amount: 1_000_000n },
];

describe("KASUS INTI: harga satuan item kontrak lama bergeser", () => {
  it("tertangkap walau VOLUMENYA sama persis – itu bentuk yang paling mudah lolos", () => {
    const baru = [
      kategori(3_100_000n),
      item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 100, unitPrice: 21_000, amount: 2_100_000n }),
      item({ lineageKey: "I#2", code: "2", name: "Papan Nama", volume: 1, unitPrice: 1_000_000, amount: 1_000_000n }),
    ];
    const h = bandingkanTerhadapAktif(berharga, baru, new Map());
    expect(h.volumeBerubah).toHaveLength(0); // volume tidak bergerak sama sekali
    expect(h.hargaBerubah).toHaveLength(1);
    expect(h.hargaBerubah[0]).toMatchObject({ code: "1", dari: 20_000, ke: 21_000, volume: 100 });
    // Dampak = (21.000 − 20.000) × 100 = +100.000, tanpa satu pun pekerjaan tambahan.
    expect(h.hargaBerubah[0].dampakRupiah).toBe(100_000n);
    // "Tetap" berarti volume DAN harga tetap — item yang harganya bergeser
    // tidak boleh ikut terhitung aman.
    expect(h.jumlahTetap).toBe(1);
  });

  it("item BARU tidak ikut ditandai – harganya memang belum pernah disepakati", () => {
    const baru = [
      kategori(3_500_000n),
      item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 100, unitPrice: 20_000 }),
      item({ lineageKey: "I#2", code: "2", name: "Papan Nama", volume: 1, unitPrice: 1_000_000 }),
      item({ lineageKey: "I#9", code: "9", name: "Pekerjaan Tambah", volume: 5, unitPrice: 100_000 }),
    ];
    const h = bandingkanTerhadapAktif(berharga, baru, new Map());
    expect(h.hargaBerubah).toHaveLength(0);
    expect(h.itemBaru.map((i) => i.code)).toEqual(["9"]);
  });

  it("beda pembulatan tulis di bawah setengah sen BUKAN perubahan harga", () => {
    const baru = [
      kategori(3_000_000n),
      item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 100, unitPrice: 20_000.004 }),
      item({ lineageKey: "I#2", code: "2", name: "Papan Nama", volume: 1, unitPrice: 1_000_000 }),
    ];
    expect(bandingkanTerhadapAktif(berharga, baru, new Map()).hargaBerubah).toHaveLength(0);
  });

  it("dampak rupiah terbesar disebut lebih dulu", () => {
    const baru = [
      kategori(3_000_000n),
      item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 100, unitPrice: 20_100 }), // +10.000
      item({ lineageKey: "I#2", code: "2", name: "Papan Nama", volume: 1, unitPrice: 800_000 }), // −200.000
    ];
    const h = bandingkanTerhadapAktif(berharga, baru, new Map());
    expect(h.hargaBerubah.map((x) => x.code)).toEqual(["2", "1"]);
    expect(h.hargaBerubah[0].dampakRupiah).toBe(-200_000n);
  });
});

/*
 * KODE ITEM DISEBUT BESERTA KATEGORINYA.
 *
 * Keluhan user 2026-09-05: *"2.d, 2.e itu yang mana, ada banyak kategori di
 * sini, seharusnya sekalian sebutkan parentnya, misal II 2.d, atau IV 11.c,
 * kalau gak gitu kan konyol"*. Nomor item hanya unik DI DALAM kategorinya:
 * berkas berdelapan-belas kategori bisa punya "2.d" di beberapa tempat
 * sekaligus, dan daftar yang menyebut "2.d" saja bukan alamat, melainkan
 * teka-teki.
 */
describe("jalur kode: kategori ikut disebut", () => {
  const katII: NodeAktif = {
    lineageKey: "II", parentLineageKey: null, kind: "kategori", code: "II",
    name: "PEKERJAAN REVETMENT", volume: null, unitPrice: null, amount: 1_000_000n,
  };
  const grup2: NodeAktif = {
    lineageKey: "II#2", parentLineageKey: "II", kind: "grup", code: "2",
    name: "Pekerjaan Beton", volume: null, unitPrice: null, amount: 1_000_000n,
  };
  const item2d: NodeAktif = {
    lineageKey: "II#2#2.d", parentLineageKey: "II#2", kind: "item", code: "2.d",
    name: "Pekerjaan beton semi mekanis", volume: 7.84, unitPrice: 100_000, amount: 784_000n,
  };
  const aktifBersarang = [katII, grup2, item2d];

  const fileNode = (o: Partial<FlatNode> & Pick<FlatNode, "lineageKey" | "code" | "name">): FlatNode => ({
    kind: "item", volume: null, unit: null, unitPrice: null, amount: 0n,
    parentLineageKey: null, sortOrder: 0, ...o,
  });

  const berkas = (volume: number): FlatNode[] => [
    fileNode({ kind: "kategori", lineageKey: "II", code: "II", name: "PEKERJAAN REVETMENT", amount: 1_000_000n }),
    fileNode({ kind: "grup", lineageKey: "II#2", code: "2", name: "Pekerjaan Beton", parentLineageKey: "II", amount: 1_000_000n }),
    fileNode({ lineageKey: "II#2#2.d", code: "2.d", name: "Pekerjaan beton semi mekanis", parentLineageKey: "II#2", volume, unitPrice: 100_000, amount: 980_000n }),
  ];

  it("volume berubah disebut 'II · 2.d', bukan '2.d' telanjang", () => {
    const h = bandingkanTerhadapAktif(aktifBersarang, berkas(9.8), new Map());
    expect(h.volumeBerubah.map((v) => v.jalur)).toEqual(["II · 2.d"]);
    // Kode aslinya tetap dibawa – ia yang dipakai mencocokkan, bukan jalurnya.
    expect(h.volumeBerubah[0].code).toBe("2.d");
  });

  it("segmen yang sudah termuat di kode anaknya tidak diulang", () => {
    // Rantainya II → 2 → 2.d; "2" tidak ditulis lagi karena "2.d" sudah memuatnya.
    const h = bandingkanTerhadapAktif(aktifBersarang, berkas(9.8), new Map());
    expect(h.volumeBerubah[0].jalur).not.toContain("· 2 ·");
  });

  it("item yang HILANG memakai jalur dari kontrak – sisi file tidak punya barisnya", () => {
    const h = bandingkanTerhadapAktif(aktifBersarang, [], new Map());
    expect(h.itemHilang.map((i) => i.jalur)).toEqual(["II · 2.d"]);
  });
});
