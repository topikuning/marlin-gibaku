// BARIS YANG DI-HIDE DI EXCEL: SEBUTKAN MANA, BUKAN CUMA BERAPA.
//
// Permintaan user 2026-09-09: *"kalau baris hidden begitu, sistem harusnya
// sebut di layar mana barisnya"*.
//
// Latarnya nyata. Pada `MC 1 FINAL GEMPOLSEWU.xlsx` resume berkasnya menulis
// 3.669.499.844 sementara sistem membaca 3.667.534.912. Selisih Rp 1.964.932 itu
// seluruhnya tiga baris yang di-hide (r463, r478, r479 di kategori VI), dan
// menemukannya menghabiskan satu sesi pembedahan manual — padahal parser SUDAH
// tahu baris mana yang dilewatinya. Yang ia katakan hanya:
//
//     "22 baris tersembunyi (hidden) di Excel diabaikan"
//
// Angka 22 tidak bisa ditindaklanjuti siapa pun. Yang bisa: nomor barisnya,
// nama pekerjaannya, dan rupiah yang ikut hilang bersamanya.
//
// Dua nada, sengaja dibedakan:
// - hidden BERNILAI  → `PERHATIAN` (banner merah): inilah yang membuat resume
//   berkas tidak sama dengan Σ item, dan orang harus memutuskan.
// - hidden bernilai 0 → catatan biasa: tidak menggeser satu rupiah pun.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHpsWorkbook } from "@/lib/rab/hps-parser";

/**
 * Tata letak lugas: kode A, uraian B, VOLUME/SATUAN/HARGA/JUMLAH di C–F.
 * `sembunyi` = nomor baris Excel yang di-hide.
 */
function berkas(sembunyi: number[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.addRow(["NO", "URAIAN PEKERJAAN", "VOLUME", "SATUAN", "HARGA SATUAN", "JUMLAH HARGA"]);
  ws.addRow(["I", "PEKERJAAN PERSIAPAN"]);
  ws.addRow(["1", "Buat Bedeng Pekerja", 50, "m2", 1_720_171, 86_008_550]);
  ws.addRow(["2", "Pekerjaan Galian Tanah", 0.12, "m3", 63_231.6, 7_587.79]);
  ws.addRow(["3", "Pekerjaan Urugan Pasir t = 5 cm", 0.38, "m3", 473_001.9, 179_740.72]);
  ws.addRow(["4", "Papan Nama Proyek", 0, "bh", 2_120_320, 0]);
  for (const r of sembunyi) ws.getRow(r).hidden = true;
  return wb;
}

const pesanTersembunyi = (warnings: string[]) =>
  warnings.find((w) => w.includes("tersembunyi")) ?? "";

describe("baris tersembunyi yang BERNILAI", () => {
  // Baris 4 dan 5 = dua pekerjaan berharga; 7.587,79 + 179.740,72 = 187.328,51.
  const { warnings } = parseHpsWorkbook(berkas([4, 5]));
  const pesan = pesanTersembunyi(warnings);

  it("menyebut NOMOR BARIS Excel-nya, bukan cuma jumlahnya", () => {
    // Inilah yang dulu tidak ada, dan yang membuat pencariannya manual.
    expect(pesan).toContain("baris 4");
    expect(pesan).toContain("baris 5");
  });

  it("menyebut nama pekerjaannya", () => {
    expect(pesan).toContain("Pekerjaan Galian Tanah");
    expect(pesan).toContain("Pekerjaan Urugan Pasir t = 5 cm");
  });

  it("menyebut rupiah yang ikut hilang, per baris dan totalnya", () => {
    expect(pesan).toContain("187.329"); // Σ, dibulatkan ke rupiah
    expect(pesan).toContain("7.588");
    expect(pesan).toContain("179.741");
  });

  it("berwarna merah – ini yang membuat resume berkas ≠ Σ item", () => {
    expect(pesan.startsWith("PERHATIAN")).toBe(true);
  });

  it("mengatakan apa yang harus dilakukan kalau memang harus ikut", () => {
    expect(pesan).toMatch(/un-?hide/i);
  });
});

describe("baris tersembunyi yang tidak bernilai", () => {
  // Baris 6 volumenya 0 → nilainya 0 → tidak menggeser apa pun.
  const { warnings } = parseHpsWorkbook(berkas([6]));
  const pesan = pesanTersembunyi(warnings);

  it("tetap disebut, tapi sebagai catatan – bukan PERHATIAN", () => {
    expect(pesan).not.toBe("");
    expect(pesan.startsWith("PERHATIAN")).toBe(false);
    expect(pesan).toContain("1 baris");
    // Tidak ada rupiah yang hilang, jadi tidak boleh ada klaim rupiah hilang.
    expect(pesan).not.toMatch(/nilai yang tidak ikut/i);
  });
});

describe("tanpa baris tersembunyi", () => {
  it("tidak berbunyi sama sekali", () => {
    const { warnings } = parseHpsWorkbook(berkas([]));
    expect(pesanTersembunyi(warnings)).toBe("");
  });
});
