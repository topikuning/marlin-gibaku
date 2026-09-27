// CCO DENGAN KOLOM HARGA TERSEMBUNYI (DECISIONS 623).
//
// Keluhan user 2026-09-27 (berkas "1. CCO1- TEGALSARI FIX.xlsx"): *"beberapa
// kali aku import yang dibaca malah penawaran, aku hide penawaran yang dibaca
// HPS … padahal di situ jelas ada cco1"*. Bentuk sheet RAB-nya:
//
//   KONTRAK (E–L: VOL · SAT · HPS · HPS · KONTRAK · KONTRAK · HARGA SATUAN ·
//   HARGA TOTAL; G–L DISEMBUNYIKAN) · BOBOT · PEKERJAAN TAMBAH · PEKERJAAN
//   KURANG · CCO 1 (VOLUME · JUMLAH HARGA · BOBOT) · KETERANGAN
//
// Yang dijaga: volume & jumlah dari blok CCO 1, harga satuan = jumlah ÷ volume
// (item yang dihapus: dari blok KURANG), dan TIDAK SATU PUN angka dari kolom
// tersembunyi – kolom itu sengaja diisi angka yang salah di sini.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHpsWorkbook } from "@/lib/rab/hps-parser";

const SAMPAH = 999_999_999;

function berkasTegalsari(opts: { sembunyikanVolCco?: boolean; asemdoyong?: boolean } = {}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  const grup = ["NO", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "JENIS PEKERJAAN",
    "KONTRAK", "KONTRAK", "KONTRAK", "KONTRAK", "KONTRAK", "KONTRAK", "KONTRAK", "KONTRAK",
    "BOBOT", "PEKERJAAN TAMBAH", "PEKERJAAN TAMBAH", "PEKERJAAN TAMBAH",
    "PEKERJAAN KURANG", "PEKERJAAN KURANG", "PEKERJAAN KURANG", "CCO 1", "CCO 1", "CCO 1", "KETERANGAN"];
  ws.getRow(14).values = grup;
  ws.getRow(15).values = ["NO", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "VOL", "SAT",
    "HPS", "HPS", "KONTRAK", "KONTRAK", "HARGA SATUAN", "HARGA TOTAL", "BOBOT",
    "PEKERJAAN TAMBAH", "PEKERJAAN TAMBAH", "PEKERJAAN TAMBAH",
    "PEKERJAAN KURANG", "PEKERJAAN KURANG", "PEKERJAAN KURANG", "CCO 1", "CCO 1", "CCO 1", "KETERANGAN"];
  ws.getRow(16).values = ["NO", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "VOL", "SAT",
    "HARGA SATUAN", "HARGA TOTAL", "HARGA SATUAN", "HARGA TOTAL", "HARGA SATUAN", "HARGA TOTAL", "BOBOT",
    "VOLUME", "JUMALH HARGA", "BOBOT", "VOLUME", "JUMALH HARGA", "BOBOT", "VOLUME", "JUMALH HARGA", "BOBOT", "KETERANGAN"];
  ws.getRow(19).values = ["I", "PEKERJAAN PERSIAPAN"];
  // [kode, nama, vol kontrak, sat, harga, vol cco]
  const item: [string, string, number, string, number, number][] = [
    ["1", "Buat Bedeng Pekerja Dan Gudang", 50, "m²", 1_314_766.94, 50],
    ["2", "Pekerjaan Sewa Rumah untuk Direksi Keetz", 6, "bln", 2_500_000, 4.5],
    ["3", "Papan Nama Proyek", 1, "bh", 1_544_551.07, 1],
    ["4", "Listrik Kerja", 6, "bln", 1_000_000, 4.5],
    ["5", "Pekerjaan Pagar Sementara", 100, "m¹", 375_994.58, 100],
    ["6", "Pembersihan Lahan", 200, "m²", 12_500, 0],
    ["7", "Direksi Keet Tambahan", 1, "unit", 25_000_000, 2],
  ];
  item.forEach(([kode, nama, vol, sat, harga, volCco], i) => {
    const tambah = Math.max(0, volCco - vol);
    const kurang = Math.max(0, vol - volCco);
    ws.getRow(20 + i).values = [
      kode, nama, null, null, vol, sat,
      // G–L: HPS, penawaran, kontrak – DISEMBUNYIKAN, isinya sengaja salah.
      SAMPAH, SAMPAH, SAMPAH, SAMPAH, SAMPAH, SAMPAH,
      1.5,
      tambah || null, tambah ? tambah * harga : null, tambah ? 0.1 : null,
      kurang || null, kurang ? kurang * harga : null, kurang ? 0.1 : null,
      volCco, volCco * harga, 2.09,
      volCco === vol ? "TETAP" : volCco > vol ? "TAMBAH" : "KURANG",
    ];
  });
  if (opts.asemdoyong) {
    // Berkas CCO1 Asemdoyong: judul blok diganti "X", HANYA G–J (HPS & penawaran)
    // yang disembunyikan; K/L = harga & jumlah kontrak yang TERLIHAT.
    for (let c = 5; c <= 12; c++) ws.getRow(14).getCell(c).value = "X";
    for (let i = 0; i < item.length; i++) {
      const [, , vol, , harga] = item[i]!;
      ws.getRow(20 + i).getCell(11).value = harga;
      ws.getRow(20 + i).getCell(12).value = vol * harga;
    }
    for (const c of [7, 8, 9, 10]) ws.getColumn(c).hidden = true;
  } else for (const c of [7, 8, 9, 10, 11, 12]) ws.getColumn(c).hidden = true;
  if (opts.sembunyikanVolCco) ws.getColumn(20).hidden = true;
  return wb;
}

describe("CCO dengan kolom harga blok kontrak tersembunyi", () => {
  it("volume & jumlah dari blok CCO 1, harga = jumlah ÷ volume, nol angka dari kolom tersembunyi", () => {
    const h = parseHpsWorkbook(berkasTegalsari());
    const item = h.parsed.categories[0]!.direct_items;
    expect(item.map((i) => i.volume)).toEqual([50, 4.5, 1, 4.5, 100, 0, 2]);
    expect(item[0]).toMatchObject({ unit: "m²", unit_price: 1_314_766.94, total_price: 65_738_347 });
    expect(item[1]).toMatchObject({ unit_price: 2_500_000, total_price: 11_250_000 });
    expect(item[6]).toMatchObject({ unit_price: 25_000_000, total_price: 50_000_000 });
    // Item yang dihapus: harganya dari blok PEKERJAAN KURANG.
    expect(item[5]).toMatchObject({ volume: 0, unit_price: 12_500 });
    const semua = JSON.stringify(h.parsed);
    expect(semua).not.toContain(String(SAMPAH));
    expect(h.warnings.join(" ")).toMatch(/disembunyikan di Excel dan tidak dibaca/);
  });

  it("kolom volume CCO ikut disembunyikan → ditolak, TIDAK dibaca dari blok HPS/penawaran", () => {
    expect(() => parseHpsWorkbook(berkasTegalsari({ sembunyikanVolCco: true }))).toThrow(/berbentuk dokumen CCO/);
  });

  it("bentuk Asemdoyong: blok dasar terpotong kolom tersembunyi, harga dari kolom kontrak yang terlihat", () => {
    const h = parseHpsWorkbook(berkasTegalsari({ asemdoyong: true }));
    const item = h.parsed.categories[0]!.direct_items;
    expect(item.map((i) => i.volume)).toEqual([50, 4.5, 1, 4.5, 100, 0, 2]);
    expect(item[0]).toMatchObject({ unit_price: 1_314_766.94, total_price: 65_738_347 });
    expect(item[6]).toMatchObject({ unit_price: 25_000_000, total_price: 50_000_000 });
    expect(JSON.stringify(h.parsed)).not.toContain(String(SAMPAH));
  });
});
