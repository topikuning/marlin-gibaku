// CCO DENGAN BLOK HASIL DI DEPAN TAMBAH/KURANG (DECISIONS 627).
//
// Berkas "RAB_CCO-1.xlsx" Bulupayung (user 2026-09-28): *"ada kolom volume di
// G, kenapa tidak ada di pilihanmu"*. Berkasnya punya sheet "Detail RAB"
// (keadaan kontrak, A–F) dan sheet "CC 0":
//
//   Kode · Uraian · Kontrak (C–F) · CC 0 - 1 (G–J) · VOLUME TAMBAH (K–N) ·
//   VOLUME KURANG (O–R) · KET
//
// Dua kegagalan: nama "CC 0" (O diketik nol) tidak dikenali sebagai sheet CCO
// sehingga "Detail RAB" yang dibaca – pratinjau adendum "0 volume berubah" –
// dan blok hasil yang berada DI DEPAN tambah/kurang tidak dikenali.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHpsBuffer, parseHpsWorkbook } from "@/lib/rab/hps-parser";

// [kode, nama, vol kontrak, sat, harga, vol cco]
const ITEM: [string, string, number, string, number, number][] = [
  ["1", "Buat Bedeng Pekerja Dan Gudang", 50, "m²", 1_404_703.97, 50],
  ["2", "Pekerjaan Sewa Rumah", 6, "bln", 2_500_000, 4.5],
  ["3", "Papan Nama Proyek", 1, "bh", 1_685_300.06, 1],
  ["4", "Listrik Kerja", 4.5, "bln", 1_000_000, 6],
];

function sheetCc0(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet("CC 0");
  ws.getRow(4).values = [null, null, "Kontrak", "Kontrak", "Kontrak", "Kontrak", "CC 0 - 1", "CC 0 - 1", "CC 0 - 1",
    "CC 0 - 1", "VOLUME TAMBAH", "VOLUME TAMBAH", "VOLUME TAMBAH", "VOLUME TAMBAH", "VOLUME KURANG",
    "VOLUME KURANG", "VOLUME KURANG", "VOLUME KURANG", "KET"];
  const sub = ["Volume", "Sat", "Harga Satuan (Rp)", "Jumlah (Rp)"];
  ws.getRow(5).values = ["Kode", "Uraian Pekerjaan", ...sub, ...sub, ...sub, ...sub];
  ws.getRow(6).values = ["I", "PEKERJAAN PERSIAPAN"];
  ITEM.forEach(([kode, nama, vol, sat, harga, volCco], i) => {
    const tambah = Math.max(0, volCco - vol);
    const kurang = Math.max(0, vol - volCco);
    ws.getRow(7 + i).values = [
      kode, nama, vol, sat, harga, vol * harga, volCco, sat, harga, volCco * harga,
      tambah || null, tambah ? sat : null, tambah ? harga : null, tambah ? tambah * harga : null,
      kurang || null, kurang ? sat : null, kurang ? harga : null, kurang ? kurang * harga : null,
      volCco === vol ? "TETAP" : volCco > vol ? "TAMBAH" : "KURANG",
    ];
  });
}

function sheetDetailRab(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet("Detail RAB");
  ws.getRow(5).values = ["Kode", "Uraian Pekerjaan", "Volume", "Sat", "Harga Satuan (Rp)", "Jumlah (Rp)"];
  ws.getRow(6).values = ["I", "PEKERJAAN PERSIAPAN"];
  ITEM.forEach(([kode, nama, vol, sat, harga], i) => {
    ws.getRow(7 + i).values = [kode, nama, vol, sat, harga, vol * harga];
  });
}

describe("CCO dengan blok hasil di depan tambah/kurang", () => {
  it("volume dari blok CC 0 - 1, harga & satuan dari Kontrak", () => {
    const wb = new ExcelJS.Workbook();
    sheetCc0(wb);
    const h = parseHpsWorkbook(wb);
    const item = h.parsed.categories[0]!.direct_items;
    expect(item.map((i) => i.volume)).toEqual([50, 4.5, 1, 6]);
    expect(item[1]).toMatchObject({ unit: "bln", unit_price: 2_500_000, total_price: 11_250_000 });
    expect(h.warnings.join(" ")).toMatch(/blok "CC 0 - 1" \(kolom G\)/);
  });

  it("berkas dengan sheet \"Detail RAB\" DAN \"CC 0\": yang dibaca CC 0", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Resume").getRow(1).values = ["RESUME"];
    sheetDetailRab(wb);
    sheetCc0(wb);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const h = await parseHpsBuffer(buf);
    expect(h.pilihan?.sheet).toBe("CC 0");
    expect(h.parsed.categories[0]!.direct_items.map((i) => i.volume)).toEqual([50, 4.5, 1, 6]);
  });
});
