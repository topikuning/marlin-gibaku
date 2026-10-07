// BARIS VARIAN HURUF "d.1" (DECISIONS 656).
//
// Laporan user 2026-10-07 (tangkapan layar adendum): baris hijau "d.1
// Pekerjaan beton semi mekanis setara fc = 25", "e.1 Pekerjaan beton…",
// "a.1 Pekerjaan Kayu Bekesting Sloof" tidak terjumlah ke impor adendum.
// Baris itu ada karena harga kontrak TIMPANG: volume sampai batas kontrak
// tetap memakai harga kontrak (baris "d"), kelebihannya memakai harga HPS
// (baris "d.1"), jadi namanya kembar dengan "d". Sebabnya bukan nama yang
// kembar: parser tidak mengenali bentuk kode "d.1" dan MEMBUANG barisnya
// tanpa peringatan.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHpsWorkbook } from "@/lib/rab/hps-parser";
import { flattenParsedRab } from "@/lib/rab/flatten";

type Baris = [string, string, number | null, string | null, number | null, number | null];

function berkas(items: Baris[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.addRow(["NAMA PROYEK", "", ": Uji Varian"]);
  ws.addRow([]);
  ws.addRow(["NO", "URAIAN PEKERJAAN", "VOLUME", "SATUAN", "HARGA SATUAN (Rp)", "JUMLAH HARGA (Rp)"]);
  ws.addRow(["I", "PEKERJAAN STRUKTUR", null, null, null, null]);
  for (const b of items) ws.addRow(b);
  return wb;
}

/** Potongan nyata dari tangkapan layar: 7 Pek. Umpak Beton Tiang Lampu. */
const UMPAK: Baris[] = [
  ["7", "Pek. Umpak Beton Tiang Lampu T = 35 cm", null, null, null, null],
  ["a", "Pekerjaan Bekesting Kolom", 5.6, "m²", 358_618.93, 2_008_266.01],
  ["b", "Pembesian Besi Beton 8 D 10 mm", 27.62, "kg", 13_028.26, 359_830.12],
  ["d", "Pekerjaan beton semi mekanis setara fc = 25", 0.69, "m³", 1_521_875.15, 1_050_093.85],
  ["d.1", "Pekerjaan beton semi mekanis setara fc = 25", 0.01, "m³", 1_521_061.2, 15_210.61],
  ["e", "Pekerjaan Langsir Cor", 0.7, "m³", 607_080.17, 424_956.12],
];

describe("kode varian huruf", () => {
  it("baris d.1 terbaca, sejajar dengan d di bawah induk yang sama, dan ikut terjumlah", () => {
    const { parsed } = parseHpsWorkbook(berkas(UMPAK));
    const induk = parsed.categories[0].direct_items[0];
    expect(induk.children.map((c) => c.code)).toEqual(["7.a", "7.b", "7.d", "7.d.1", "7.e"]);
    const d1 = induk.children.find((c) => c.code === "7.d.1")!;
    expect(d1).toMatchObject({ volume: 0.01, unit_price: 1_521_061.2, total_price: 15_210.61 });
    const total = UMPAK.reduce((t, b) => t + (b[5] ?? 0), 0);
    expect(parsed.categories[0].total_value).toBeCloseTo(total, 2);
  });

  it("nama kembar dengan saudaranya tetap dua item berbeda dengan kunci berbeda", () => {
    const nodes = flattenParsedRab(parseHpsWorkbook(berkas(UMPAK)).parsed);
    const beton = nodes.filter((n) => n.name === "Pekerjaan beton semi mekanis setara fc = 25");
    expect(beton.map((n) => n.lineageKey)).toEqual(["I#7#7.d", "I#7#7.d.1"]);
    expect(beton.map((n) => n.amount)).toEqual([1_050_094n, 15_211n]);
  });

  it("ekspor RAB menulis kode lengkap \"7.d.1\" – terbaca ulang sejajar dengan 7.d, bukan anaknya", () => {
    const ulang: Baris[] = UMPAK.map((b) => (b[0] === "7" ? b : ([`7.${b[0]}`, ...b.slice(1)] as Baris)));
    const { parsed } = parseHpsWorkbook(berkas(ulang));
    const induk = parsed.categories[0].direct_items[0];
    expect(induk.children.map((c) => c.code)).toEqual(["7.a", "7.b", "7.d", "7.d.1", "7.e"]);
    expect(induk.children.every((c) => c.children.length === 0)).toBe(true);
  });

  it("kode lain yang tidak dikenali tapi bernilai DISEBUT, tidak hilang diam-diam", () => {
    const aneh: Baris[] = [...UMPAK, ["d-1x", "Baris berkode aneh", 1, "m³", 50_000, 50_000]];
    const { warnings } = parseHpsWorkbook(berkas(aneh));
    expect(warnings.some((w) => w.includes('berkode "d-1x"') && w.includes("TIDAK ikut dihitung"))).toBe(true);
  });
});
