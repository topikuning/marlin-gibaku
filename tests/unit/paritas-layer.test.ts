// PAGAR TETAP: YANG DISIMPAN HARUS SAMA DENGAN YANG DIBACA.
//
// Teguran user 2026-09-07, sesudah dua berkas beruntun memaksa pembedahan
// manual: *"ini bukan hanya untuk case file ini, bisa jadi ada file lain, aku
// tidak ingin berulang kali kita buang waktu di parsing data adendum"*.
//
// Betul. Empat kegagalan terakhir (DECISIONS 540, 541, 542, 543) semuanya
// ketahuan dengan cara yang sama: user melihat angka janggal di layar, lalu satu
// sesi habis membedah berkasnya. Padahal ketiga dari empat itu punya SATU bentuk
// yang bisa dijaga mesin — angka yang akan masuk DB tidak sama dengan angka yang
// dibaca dari berkasnya.
//
// Yang sudah ada sebelum ini hanya menjaga separuh jalan:
//
//   berkas ──(hps-parser)──> parsed.total ──(flatten)──> RabNode.amount
//            └── dijaga: Σ item vs total yang DITULIS berkas ┘
//                                        └── TIDAK dijaga ───┘
//
// Ruas kedua itulah yang melewatkan Rp 35.003.407 pada `MC 1 FINAL GEMPOLSEWU`:
// `parsed.total` benar dan sudah dicek-silang terhadap berkasnya, lalu `flatten`
// menyimpan angka lain, dan tak satu pun layar menyebutkan bedanya.
//
// `bedaAntarLayer` menutup ruas itu untuk SEMUA berkas, bukan berkas itu.
// Sifatnya bukan peringatan: dua calculation layer yang berselisih adalah cacat
// KODE, bukan cacat berkas, dan nilai kontrak tidak boleh ditulis dari yang
// mana pun sampai keduanya sepakat.
import { describe, expect, it } from "vitest";
import { bedaAntarLayer, flattenParsedRab, grandTotal } from "@/lib/rab/flatten";
import type { ParsedRab, ParsedRabCategory, ParsedRabItem } from "@/lib/rab/parsed";
import { sumLeaves } from "@/lib/rab/hps-parser";

function daun(code: string, harga: number, children: ParsedRabItem[] = []): ParsedRabItem {
  return {
    code,
    name: `Pekerjaan ${code}`,
    volume: 1,
    unit: "ls",
    unit_price: harga,
    total_price: harga,
    tkdn_ratio: null,
    children,
  };
}

function kat(roman: string, items: ParsedRabItem[]): ParsedRabCategory {
  return {
    roman,
    name: `KATEGORI ${roman}`,
    total_value: sumLeaves(items),
    subcategories: [],
    direct_items: items,
  };
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
    total: categories.reduce((t, c) => t + c.total_value, 0),
    categories,
  };
}

/** Berkas normal: satu kategori berisi, satu kategori dengan induk berharga. */
function berkasWajar(): ParsedRab {
  return rab([
    kat("I", [daun("1", 10_000_000), daun("2", 5_000_000)]),
    kat("II", [daun("1", 35_003_407, [daun("a", 23_937_845), daun("b", 5_556_092)])]),
  ]);
}

describe("paritas antar calculation layer", () => {
  it("berkas yang sehat: tidak ada yang dilaporkan", () => {
    const parsed = berkasWajar();
    expect(bedaAntarLayer(parsed, flattenParsedRab(parsed))).toEqual([]);
  });

  it("angka yang disimpan = angka yang dibaca, sampai ke rupiah", () => {
    const parsed = berkasWajar();
    expect(grandTotal(flattenParsedRab(parsed))).toBe(BigInt(Math.round(parsed.total)));
  });

  it("selisih SEKECIL apa pun tetap dilaporkan, dengan angkanya", () => {
    // Menirukan bentuk cacatnya: parser membaca satu angka, flatten menyimpan
    // angka lain. Satu rupiah pun cukup — ini cacat kode, bukan pembulatan;
    // apportionment `flatten` menjamin Σ anak == induk PERSIS.
    const parsed = berkasWajar();
    const nodes = flattenParsedRab(parsed);
    parsed.total += 2;
    const beda = bedaAntarLayer(parsed, nodes);
    expect(beda).toHaveLength(1);
    expect(beda[0].label).toBe("SELURUH BERKAS");
    expect(beda[0].masuk).toBe(grandTotal(nodes));
    expect(beda[0].berkas - beda[0].masuk).toBe(2n);
  });

  it("menyebut KATEGORI mana yang meleset, bukan hanya totalnya", () => {
    // Tanpa ini, pesan galatnya cuma "total beda 35 juta" dan pembedahan
    // manual dimulai lagi dari nol. Yang menghemat waktu adalah namanya.
    const parsed = berkasWajar();
    const nodes = flattenParsedRab(parsed);
    parsed.categories[1].total_value += 35_003_407;
    parsed.total += 35_003_407;
    const beda = bedaAntarLayer(parsed, nodes);
    expect(beda.map((b) => b.label)).toEqual(["II KATEGORI II", "SELURUH BERKAS"]);
    expect(beda[0].berkas - beda[0].masuk).toBe(35_003_407n);
  });

  it("kategori yang memang dibuang (template kosong) bukan selisih", () => {
    // Judul tanpa satu pun baris berharga tidak masuk DB — itu perilaku yang
    // disengaja (DECISIONS 542), dan nilainya nol, jadi tidak ada yang hilang.
    const parsed = rab([kat("I", [daun("1", 10_000_000)]), kat("II", [])]);
    expect(bedaAntarLayer(parsed, flattenParsedRab(parsed))).toEqual([]);
  });
});
