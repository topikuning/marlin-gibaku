/*
 * BARIS EXCEL-nya DISEBUT — nama item saja tidak menunjuk apa pun.
 *
 * **Permintaan user 2026-09-23**, sesudah membaca pesan penolakan volume
 * negatif (DECISIONS 606):
 *
 *   *"lalu penunjuk item juga perlu informasi rows berapa agar spesifik
 *   masalah di filenya yang mana"*
 *
 * Benar, dan berkas yang memicunya membuktikannya sendiri: di `MC 1 BETAH
 * WALANG`, nama *"Pekerjaan Bekesting Pasangan Batako"* muncul **sembilan
 * kali** di sheet RAB (baris 940, 976, 1058, 1091, 1100, 1177, 1199, 1288, …),
 * dan yang bermasalah cuma SATU — baris 191, blok KURANG, volume −42. Pesan
 * yang menyebut nama tanpa baris menyuruh orang menyisir 1.300 baris untuk
 * menemukan mana yang dimaksud; nomor kode pun tidak menolong karena ia hanya
 * unik di dalam induknya ("d" ada di mana-mana).
 *
 * Nomor baris satu-satunya penunjuk yang bisa langsung diketik ke kotak
 * "Go To" Excel. Karena itu ia dibawa dari parser sampai ke pesan di layar,
 * bukan dihitung ulang belakangan — sesudah `flatten`, baris aslinya sudah
 * tidak ada lagi di mana pun.
 */
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

const { parseHpsWorkbook } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab, barisTanpaJumlah } = await import("@/lib/rab/flatten");

/** Workbook kecil dengan letak baris yang SUDAH DIKETAHUI. */
function bukuUji(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.getCell(1, 1).value = "NO";
  ws.getCell(1, 2).value = "URAIAN";
  ws.getCell(1, 3).value = "VOL";
  ws.getCell(1, 4).value = "SAT";
  ws.getCell(1, 5).value = "HARGA SATUAN";
  ws.getCell(1, 6).value = "JUMLAH HARGA";

  ws.getCell(2, 1).value = "I";
  ws.getCell(2, 2).value = "PEKERJAAN PERSIAPAN";

  // Baris 3 dan baris 7 SENGAJA sama namanya — persis bentuk yang membuat
  // pesan tanpa nomor baris tidak bisa ditindaklanjuti.
  ws.getCell(3, 1).value = "1";
  ws.getCell(3, 2).value = "Pekerjaan Bekesting";
  ws.getCell(3, 3).value = 10;
  ws.getCell(3, 4).value = "m2";
  ws.getCell(3, 5).value = 100_000;
  ws.getCell(3, 6).value = 1_000_000;

  ws.getCell(7, 1).value = "2";
  ws.getCell(7, 2).value = "Pekerjaan Bekesting";
  ws.getCell(7, 3).value = 5;
  ws.getCell(7, 4).value = "m2";
  ws.getCell(7, 5).value = 200_000;
  // Kolom JUMLAH sengaja KOSONG – dipakai menguji `barisTanpaJumlah`.
  return wb;
}

describe("parser membawa nomor baris Excel tiap item", () => {
  it("item mencatat baris aslinya, bukan urutannya di pohon", () => {
    const { parsed } = parseHpsWorkbook(bukuUji());
    const item = parsed.categories[0].direct_items;
    expect(item.map((x) => x.excel_row)).toEqual([3, 7]);
  });

  it("nomor baris ikut sampai ke FlatNode – di situlah pesan menuliskannya", () => {
    const nodes = flattenParsedRab(parseHpsWorkbook(bukuUji()).parsed);
    const baris = nodes.filter((n) => n.kind === "item").map((n) => n.excelRow);
    expect(baris).toEqual([3, 7]);
  });

  it("kategori tidak dipaksa punya baris – yang ditunjuk orang adalah ITEMnya", () => {
    const nodes = flattenParsedRab(parseHpsWorkbook(bukuUji()).parsed);
    expect(nodes.find((n) => n.kind === "kategori")?.excelRow).toBeNull();
  });

  it("baris tanpa kolom JUMLAH pun menyebut barisnya", () => {
    // Peringatan ini juga menyuruh orang membuka Excel dan membetulkan sesuatu;
    // tanpa nomor baris, perintahnya tidak bisa dijalankan.
    const { parsed } = parseHpsWorkbook(bukuUji());
    const kosong = barisTanpaJumlah(parsed);
    expect(kosong).toHaveLength(1);
    expect(kosong[0].excelRow).toBe(7);
  });
});
