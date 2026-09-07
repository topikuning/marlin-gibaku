// BARIS INDUK YANG PUNYA NILAI SENDIRI **DAN** RINCIAN.
//
// Pertanyaan user 2026-09-07 setelah impor `MC 1 FINAL GEMPOLSEWU` diperbaiki:
// *"jika file itu kumasukkan, apakah totalnya sudah sama dengan file itu untuk
// semua kategorinya?!"* — dan belum. Dua belas kategori cocok sampai ke rupiah;
// **II PEKERJAAN REVETMENT** kurang Rp 35.003.407.
//
// Sebabnya dua calculation layer memberi dua angka untuk baris yang sama:
//
// | layer | induk berharga + beranak | kat. II |
// |---|---|---|
// | `sumLeaves` (→ `parsed.total`) | `own + Σanak` | 441.205.889 |
// | `flattenParsedRab` (→ `RabNode.amount`) | `Σanak` saja | 406.202.482 |
//
// Komentar di `flatten.ts` menyebut dirinya mengikuti "semantik sumLeaves lama",
// dan memang mengikuti versi LAMA-nya: `sumLeaves` punya empat cabang, `flatten`
// dua. Cabang yang hilang justru yang dulu sengaja ditambahkan ke `sumLeaves`
// ("Bug lama: nilai induk hilang").
//
// Buktinya sheet RAB baris 138: *"7 Pekerjaan Bekesting Dinding 5 kali pakai"*,
// 96 m² × 364.618,83 = 35.003.407,68 — DENGAN anak 139–141 (pembesian D13,
// pembesian D10, beton, vibrator) senilai 58.152.146. Keduanya pekerjaan yang
// berbeda; keduanya nyata; hanya yang anak yang masuk.
//
// ### Kenapa tidak cukup menaruh 35 juta itu di node induknya
//
// Laporan harian dan `hitungProgress` hanya mengenal `rn.kind = 'item'`. Uang
// yang menempel di node `grup` tidak akan pernah bisa dilaporkan: progres tidak
// akan pernah sampai 100%, dan Σ bobot item di blanko KKP jatuh di bawah 100%
// (dijaga `tests/integration/periodic-report.test.ts`).
//
// ### Yang dipilih: anaknya DINAIKKAN jadi saudara
//
// Induk yang punya `volume × harga` sendiri adalah PEKERJAAN, bukan judul. Baris
// di bawahnya karena itu bukan rinciannya — kalau memang rincian, jumlahnya akan
// sama dengan induknya (dan cabang "subtotal" yang sudah ada menanganinya). Jadi
// induknya dibaca sebagai item biasa dan baris-baris di bawahnya naik sejajar
// dengannya. Uangnya utuh, semuanya ada di daun, dan kedua layer akhirnya
// mengucapkan angka yang sama.
import { describe, expect, it } from "vitest";
import { sumLeaves } from "@/lib/rab/hps-parser";
import { flattenParsedRab, grandTotal } from "@/lib/rab/flatten";
import type { ParsedRab, ParsedRabCategory, ParsedRabItem } from "@/lib/rab/parsed";

function it_(
  code: string,
  name: string,
  volume: number | null,
  harga: number | null,
  children: ParsedRabItem[] = [],
): ParsedRabItem {
  return {
    code,
    name,
    volume,
    unit: volume == null ? null : "m²",
    unit_price: harga,
    total_price: volume != null && harga != null ? volume * harga : null,
    tkdn_ratio: null,
    children,
  };
}

function rab(direct: ParsedRabItem[]): ParsedRab {
  const kat: ParsedRabCategory = {
    roman: "II",
    name: "PEKERJAAN REVETMENT",
    total_value: 0,
    subcategories: [],
    direct_items: direct,
  };
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
    categories: [kat],
  };
}

/** Bentuk baris 138–141 berkas GEMPOLSEWU, angka aslinya. */
const BEKESTING = it_("7", "Pekerjaan Bekesting Dinding 5 kali pakai", 96, 364_618.83, [
  it_("a", "Pek. Pembesian Besi Beton D 13 mm - 200 (V)", 1010.211696, 23_695.87),
  it_("b", "Pek. Pembesian Besi Beton D 10 mm - 200 (H)", 322.1829, 17_245.15),
  it_("c", "Pekerjaan beton semi mekanis setara fc = 25", 16.8, 1_669_765.17),
  it_("d", "Pekerjaan Pemadatan Beton dengan Vibrator", 16.8, 36_080.56),
]);

describe("induk berharga yang juga punya rincian", () => {
  const parsed = rab([BEKESTING]);
  const nodes = flattenParsedRab(parsed);

  it("nilainya UTUH: sama dengan yang dibaca parser dari berkas", () => {
    // 35.003.407,68 (induk) + 58.152.145,x (anak) = 93.155.553 dibulatkan sekali
    // di puncak, seperti Excel. Sebelum perbaikan: 58.152.146 — 35 juta hilang
    // tanpa suara.
    const dariBerkas = BigInt(Math.round(sumLeaves(parsed.categories[0].direct_items)));
    expect(dariBerkas).toBe(93_155_553n);
    expect(grandTotal(nodes)).toBe(dariBerkas);
  });

  it("SELURUH uang ada di baris `item` – syarat Σ bobot KKP = 100%", () => {
    // Laporan harian & progress hanya mengenal kind 'item'. Rupiah yang
    // menempel di node 'grup' tidak akan pernah bisa dilaporkan.
    const perItem = nodes.filter((n) => n.kind === "item").reduce((t, n) => t + n.amount, 0n);
    expect(perItem).toBe(grandTotal(nodes));
  });

  it("induknya jadi item biasa, anaknya naik sejajar dengannya", () => {
    const tujuh = nodes.find((n) => n.code === "7")!;
    expect(tujuh.kind).toBe("item");
    expect(tujuh.volume).toBe(96);
    expect(tujuh.unitPrice).toBe(364_618.83);
    // 35.003.407,68 — sisa pembulatan satu rupiah jatuh ke pecahan terbesar
    // (apportionment largest-remainder), jadi 35.003.408 dan Σ tetap tepat.
    expect(tujuh.amount).toBe(35_003_408n);

    const anak = nodes.filter((n) => ["a", "b", "c", "d"].includes(n.code));
    expect(anak).toHaveLength(4);
    for (const n of anak) expect(n.parentLineageKey).toBe("II");
    // Urutan dokumen dijaga: induknya lebih dulu, lalu baris-baris di bawahnya.
    expect(nodes.map((n) => n.code)).toEqual(["II", "7", "a", "b", "c", "d"]);
  });
});

describe("bentuk lain TIDAK ikut berubah", () => {
  it("baris grup yang memuat SUBTOTAL anaknya tidak dihitung dua kali", () => {
    // Konvensi RAB KKP: baris induk menulis subtotal rinciannya. Kalau ini ikut
    // dinaikkan, seluruh berkas KKP akan berlipat dua.
    const anak = [it_("a", "Galian", 10, 1_000_000), it_("b", "Urugan", 5, 1_000_000)];
    const induk = it_("1", "Pekerjaan Pondasi", null, null, anak);
    induk.total_price = 15_000_000; // subtotal, sama dengan Σ anak
    const nodes = flattenParsedRab(rab([induk]));
    expect(grandTotal(nodes)).toBe(15_000_000n);
    expect(nodes.find((n) => n.code === "1")!.kind).toBe("grup");
    expect(nodes.find((n) => n.code === "a")!.parentLineageKey).toBe("II#1");
  });

  it("judul grup tanpa nilai sendiri tetap grup, anaknya tetap bersarang", () => {
    const induk = it_("1", "Pekerjaan Pondasi", null, null, [
      it_("a", "Galian", 10, 1_000_000),
      it_("b", "Urugan", 5, 1_000_000),
    ]);
    const nodes = flattenParsedRab(rab([induk]));
    expect(grandTotal(nodes)).toBe(15_000_000n);
    expect(nodes.find((n) => n.code === "1")!.kind).toBe("grup");
    expect(nodes.find((n) => n.code === "b")!.parentLineageKey).toBe("II#1");
  });

  it("grup yang seluruh anaknya nihil tetap dibaca dari nilainya sendiri", () => {
    // Perilaku lama yang dijaga: anak tanpa angka sama sekali (mis. baris
    // keterangan) tidak boleh menghapus nilai induknya.
    const induk = it_("1", "Pekerjaan Lump Sum", 1, 9_000_000, [
      it_("a", "keterangan", null, null),
    ]);
    const nodes = flattenParsedRab(rab([induk]));
    expect(grandTotal(nodes)).toBe(9_000_000n);
  });
});
