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
  { lineageKey: "I", kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", volume: null, amount: 3_000_000n },
  { lineageKey: "I#1", kind: "item", code: "1", name: "Galian Tanah", volume: 100, amount: 2_000_000n },
  { lineageKey: "I#2", kind: "item", code: "2", name: "Papan Nama", volume: 1, amount: 1_000_000n },
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
      { lineageKey: "I#2", code: "2", name: "Papan Nama", realisasi: 1 },
    ]);
  });

  it("yang sudah dikerjakan diurutkan LEBIH DULU daripada yang belum", () => {
    const dua: NodeAktif[] = [
      ...aktif,
      { lineageKey: "I#3", kind: "item", code: "3", name: "Belum Dikerjakan", volume: 5, amount: 0n },
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
    const baru = [
      kategori(3_000_000n),
      item({ lineageKey: "I#1", code: "1", name: "Galian Tanah", volume: 100 }),
      item({ lineageKey: "I#2", code: "2", name: "Papan Nama", volume: 1 }),
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
