// BARIS YANG KOLOM JUMLAHNYA KOSONG DI BERKAS TIDAK BOLEH DIKARANG SENDIRI.
//
// Laporan user 2026-09-17, berkas `6 NEGO PENAWARAN KNMP DESA PANTAI HARAPAN
// PENYANGGA DARAT.xlsx`. Impor ditolak pagar antar-layer:
//
//   III PEKERJAAN BANGUNAN SHELTER PENDARATAN IKAN:
//   berkas 204.659.684, akan tersimpan 215.671.940 (selisih -11.012.256)
//
// Sebabnya satu baris, RAB!177 "Pekerjaan Pancang Cerucuk Dolken": volume 288
// (F) dan harga satuan 38.237 (H) ada, tetapi sel JUMLAH-nya (I177) TIDAK ADA —
// dihapus saat negosiasi. Subtotal berkasnya sendiri `SUM(I166:I214)` karena itu
// melewatinya, sementara `leafRaw` di flatten.ts mengarang 288 × 38.237 =
// 11.012.256 dan memasukkannya. Persis satu selisih itu.
//
// Mengarang angka yang tidak ada di berkas adalah yang dilarang DECISIONS 203 —
// dan di sini berkasnya bahkan MENYATAKAN sebaliknya lewat subtotalnya sendiri.
// Yang benar: ikuti berkas (baris itu bernilai nol), lalu KATAKAN barisnya,
// karena volume dan harga satuan yang menganggur memang patut diperiksa orang.
import { describe, expect, it } from "vitest";
import { bedaAntarLayer, flattenParsedRab, grandTotal, barisTanpaJumlah } from "@/lib/rab/flatten";
import type { ParsedRab, ParsedRabItem } from "@/lib/rab/parsed";

const item = (over: Partial<ParsedRabItem> & { code: string; name: string }): ParsedRabItem => ({
  volume: null,
  unit: null,
  unit_price: null,
  total_price: null,
  tkdn_ratio: null,
  parent_code: null,
  children: [],
  ...over,
});

const META: ParsedRab["meta"] = {
  slug: "uji",
  village: null,
  regency: null,
  province: null,
  gps_lat: null,
  gps_lng: null,
  contract_number: null,
  contractor: null,
  start_date: null,
  end_date: null,
};

/** Dua baris berjumlah, satu baris yang jumlahnya dihapus di berkas. */
const LAIN = 1_754_784;
const DOLKEN_VOL = 288;
const DOLKEN_HARGA = 38_237;
/** Yang DITULIS berkas sebagai subtotal kategori – tanpa baris dolken. */
const SUBTOTAL_BERKAS = LAIN + 12_763_322;

function berkas(): ParsedRab {
  return {
    meta: META,
    project: "UJI",
    year: 2026,
    total: SUBTOTAL_BERKAS,
    categories: [
      {
        roman: "III",
        name: "PEKERJAAN BANGUNAN SHELTER PENDARATAN IKAN",
        total_value: SUBTOTAL_BERKAS,
        subcategories: [],
        direct_items: [
          item({ code: "a", name: "Pekerjaan Galian Tanah", volume: 12.96, unit_price: 135_400, total_price: LAIN }),
          // Inilah barisnya: volume & harga satuan ADA, jumlahnya TIDAK.
          item({
            code: "b",
            name: "Pekerjaan Pancang Cerucuk Dolken",
            volume: DOLKEN_VOL,
            unit_price: DOLKEN_HARGA,
            total_price: null,
          }),
          item({ code: "c", name: "Pekerjaan Pondasi Batu Belah 1 : 5", volume: 7.92, unit_price: 1_611_530, total_price: 12_763_322 }),
        ],
      },
    ],
  };
}

describe("baris tanpa kolom jumlah", () => {
  it("tidak menggelembungkan kategori – yang tersimpan sama dengan yang dibaca", () => {
    const nodes = flattenParsedRab(berkas());
    expect(bedaAntarLayer(berkas(), nodes)).toEqual([]);
    expect(grandTotal(nodes)).toBe(BigInt(SUBTOTAL_BERKAS));
  });

  it("barisnya tetap ada dengan nilai nol – bukan dihapus diam-diam", () => {
    const nodes = flattenParsedRab(berkas());
    const dolken = nodes.find((n) => n.name.includes("Dolken"));
    if (!dolken) throw new Error("baris dolken hilang dari hasil impor");
    expect(dolken.amount).toBe(0n);
    // Volume & harga satuannya TIDAK ikut dibuang: itu yang membuat orang bisa
    // melihat bahwa jumlahnya memang belum diisi.
    expect(dolken.volume).toBe(DOLKEN_VOL);
    expect(dolken.unitPrice).toBe(DOLKEN_HARGA);
  });

  it("barisnya disebutkan, lengkap dengan nilai yang TIDAK jadi diikutkan", () => {
    const daftar = barisTanpaJumlah(berkas());
    expect(daftar).toHaveLength(1);
    expect(daftar[0].name).toContain("Dolken");
    expect(daftar[0].seandainya).toBe(DOLKEN_VOL * DOLKEN_HARGA);
  });

  it("baris tanpa volume MAUPUN jumlah bukan temuan – itu cuma baris judul", () => {
    const p = berkas();
    p.categories[0].direct_items.push(item({ code: "d", name: "Lain-lain" }));
    expect(barisTanpaJumlah(p)).toHaveLength(1);
  });
});
