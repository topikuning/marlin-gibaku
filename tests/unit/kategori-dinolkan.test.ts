// KATEGORI YANG DINOLKAN ADENDUM ≠ KATEGORI KOSONG.
//
// Laporan user 2026-09-07 (MC 1 FINAL GEMPOLSEWU): pratinjau impor menyebut
// *"146 item kontrak tidak ada di file ini"* — *"padahal di file itu ada"*.
// Benar, ada. Yang tidak ada adalah keluarannya.
//
// Berkas itu adendum: blok hasil (CCO-01) menolkan seluruh volume kategori
// "III PEKERJAAN TAMBATAN PERAHU" (116 baris) dan "IV PEKERJAAN DINDING PENAHAN
// TANAH" (12 baris). Barisnya utuh — kode, nama, satuan, harga satuan semuanya
// terbaca — hanya volumenya 0, sehingga nilai kategorinya 0.
//
// Lalu `flattenParsedRab` membuangnya, dengan alasan yang dulu benar:
//
//     // Kategori bernilai 0 (template kosong: mis. SENTRA KULINER, BALAI
//     // NELAYAN) TIDAK dimasukkan ke DB — tak ada pekerjaan di dalamnya.
//
// Pada HPS baru itu memang template yang belum diisi. Pada ADENDUM artinya
// terbalik: pekerjaannya ADA di kontrak, dan justru sedang dihapus. Membuang
// barisnya membuat pratinjau kehilangan pasangannya, jadi seluruh kategori
// terbaca "hilang dari file" — termasuk `IV.1 · 1.a Pekerjaan Galian Tanah`
// yang realisasinya sudah 22,61. Bedanya bukan kosmetik: "item hilang" berarti
// realisasi lepas dari induknya, sedangkan "volume jadi 0 padahal sudah
// dikerjakan" adalah panel merah yang memang harus menyala.
//
// Pembedanya BARIS BERHARGA, bukan nilai kategorinya: template kosong tidak
// punya satu pun harga satuan; kategori yang dinolkan punya semuanya.
import { describe, expect, it } from "vitest";
import { bandingkanTerhadapAktif, type NodeAktif } from "@/lib/rab/diff-parsed";
import { flattenParsedRab } from "@/lib/rab/flatten";
import type { ParsedRab, ParsedRabCategory, ParsedRabItem } from "@/lib/rab/parsed";

function item(code: string, name: string, volume: number | null, harga: number | null): ParsedRabItem {
  return {
    code,
    name,
    volume,
    unit: "m³",
    unit_price: harga,
    total_price: null,
    tkdn_ratio: null,
    children: [],
  };
}

function kategori(roman: string, name: string, items: ParsedRabItem[]): ParsedRabCategory {
  return { roman, name, total_value: 0, subcategories: [], direct_items: items };
}

function rab(categories: ParsedRabCategory[]): ParsedRab {
  return {
    meta: {
      slug: null,
      village: null,
      regency: null,
      province: null,
      gps_lat: null,
      gps_lng: null,
      contract_number: null,
      contractor: null,
      start_date: null,
      end_date: null,
    },
    project: "UJI",
    year: null,
    total: 0,
    categories,
  };
}

/** "II" berharga penuh, "III" dinolkan adendum, "IV" template yang belum diisi. */
const BERKAS = rab([
  kategori("II", "PEKERJAAN REVETMENT", [item("1", "Pasangan Batu", 40, 900_000)]),
  kategori("III", "PEKERJAAN TAMBATAN PERAHU", [
    item("1.a", "Pekerjaan Bekesting Pondasi", 0, 313_684.31),
    item("1.b", "Pembesian Besi Beton D 13 mm", 0, 23_695.87),
  ]),
  kategori("IV", "PEKERJAAN SENTRA KULINER", [item("1", "Belum diisi", null, null)]),
]);

describe("kategori bernilai 0", () => {
  const nodes = flattenParsedRab(BERKAS);
  const akar = (key: string) => key.split("#")[0];

  it("yang barisnya BERHARGA tetap keluar, dengan volume 0 apa adanya", () => {
    const III = nodes.filter((n) => akar(n.lineageKey) === "III");
    // Sebelum perbaikan: 0 node — seluruh kategori raib dari keluaran.
    expect(III.filter((n) => n.kind === "item")).toHaveLength(2);
    const bekesting = III.find((n) => n.code === "1.a")!;
    expect(bekesting.volume).toBe(0);
    // Harga satuan kontrak tetap dibawa — yang dinolkan volumenya, bukan harganya.
    expect(bekesting.unitPrice).toBe(313_684.31);
    expect(bekesting.amount).toBe(0n);
    expect(nodes.find((n) => n.lineageKey === "III")!.amount).toBe(0n);
  });

  it("template yang belum diisi tetap dibuang", () => {
    // Tidak satu pun harga satuan di bawahnya = tidak ada pekerjaan yang
    // dihapus, hanya judul yang tidak terpakai.
    expect(nodes.filter((n) => akar(n.lineageKey) === "IV")).toHaveLength(0);
  });

  it("kategori berisi tidak terpengaruh", () => {
    expect(nodes.find((n) => n.lineageKey === "II#1")!.amount).toBe(36_000_000n);
  });
});

describe("pratinjau impor adendum", () => {
  /** RAB aktif: kategori III masih penuh volumenya, dan sudah ada realisasi. */
  const aktif: NodeAktif[] = [
    {
      lineageKey: "III",
      parentLineageKey: null,
      kind: "kategori",
      code: "III",
      name: "PEKERJAAN TAMBATAN PERAHU",
      volume: null,
      unitPrice: null,
      amount: 3_136_843n,
      },
    {
      lineageKey: "III#1.a",
      parentLineageKey: "III",
      kind: "item",
      code: "1.a",
      name: "Pekerjaan Bekesting Pondasi",
      volume: 10,
      unitPrice: 313_684.31,
      amount: 3_136_843n,
    },
    {
      lineageKey: "III#1.b",
      parentLineageKey: "III",
      kind: "item",
      code: "1.b",
      name: "Pembesian Besi Beton D 13 mm",
      volume: 0,
      unitPrice: 23_695.87,
      amount: 0n,
    },
  ];

  it("melaporkan VOLUME JADI 0, bukan 'item kontrak tidak ada di file ini'", () => {
    const baru = flattenParsedRab(rab([BERKAS.categories[1]]));
    const beda = bandingkanTerhadapAktif(aktif, baru, new Map([["III#1.a", 22.61]]));

    expect(beda.itemHilang).toHaveLength(0);
    const turun = beda.volumeBerubah.find((v) => v.lineageKey === "III#1.a")!;
    expect(turun, "penurunan volume tidak dilaporkan").toBeTruthy();
    expect(turun.dari).toBe(10);
    expect(turun.ke).toBe(0);
    // Pekerjaan yang sudah dilaporkan 22,61 tapi volume kontraknya jadi 0 —
    // inilah yang harus menyala merah, dan yang dulu hilang bersama barisnya.
    expect(turun.realisasi).toBe(22.61);
    expect(turun.dibawahRealisasi).toBe(true);
  });
});
