// CCO 1 KRAKAHAN (DECISIONS 679).
//
// Dua laporan user 2026-10-15 untuk berkas yang sama:
// 1. Item XIII.11 "Pekerjaan Skonengan" punya jumlah, tapi harga satuannya
//    KOSONG. Item itu baru masuk di CCO-01: kolom MC-0 (vol E, harga K,
//    jumlah L) kosong, harganya ada di blok CCO-01 (Y). Jalur CCO selalu
//    mengambil harga dari blok DASAR.
// 2. *"kenapa di sheet mc0, kolom y z dst tidak muncul di pilihan mapping
//    kolom"*: pilihan kolom tangan hanya menjangkau A..X.
// Ditambah yang ketahuan saat menganalisis berkasnya: PEKERJAAN TAMBAH (R–T)
// dan KURANG (U–W) DISEMBUNYIKAN, sehingga berkasnya tidak dikenali sebagai
// CCO dan yang terbaca nilai MC-0 – kontrak lama, kategori baru bernilai 0.
//
// Susunan tiruan di bawah meniru sheet "MC 0" berkas aslinya (baris judul 10,
// sub-judul 12, data dari 14). Kolom tersembunyi sengaja diisi SAMPAH.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHpsWorkbook, ringkasKolom } from "@/lib/rab/hps-parser";
import { flattenParsedRab } from "@/lib/rab/flatten";

const SAMPAH = 999_999_999;

function berkasKrakahan(opts: { tambahKurangTerlihat?: boolean } = {}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("MC 0");
  const grup: (string | null)[] = ["NO", "ITEM PEKERJAAN", "ITEM PEKERJAAN", "ITEM PEKERJAAN"];
  for (let c = 5; c <= 17; c++) grup.push("MC-0"); // E..Q
  for (let c = 18; c <= 20; c++) grup.push("PEKERJAAN TAMBAH"); // R..T
  for (let c = 21; c <= 23; c++) grup.push("PEKERJAAN KURANG"); // U..W
  for (let c = 24; c <= 27; c++) grup.push("CCO-01"); // X..AA
  grup.push("KETERANGAN"); // AB
  ws.getRow(10).values = grup as ExcelJS.CellValue[];
  const sub: Record<number, string> = {
    5: "VOLUME", 6: "SAT", 11: "HARGA SATUAN", 12: "JUMLAH HARGA", 17: "BOBOT",
    18: "VOLUME", 19: "JUMLAH HARGA", 20: "BOBOT", 21: "VOLUME", 22: "JUMLAH HARGA", 23: "BOBOT",
    24: "VOLUME", 25: "HARGA SATUAN", 26: "JUMLAH HARGA", 27: "BOBOT",
  };
  for (const [c, t] of Object.entries(sub)) ws.getRow(12).getCell(Number(c)).value = t;

  // [kode, nama, vol MC-0 (null = item baru CCO), sat, harga, vol CCO-01]
  type Baris = [string, string, number | null, string, number, number];
  const kategori: [string, string, Baris[]][] = [
    ["I", "PEKERJAAN PERSIAPAN", [
      ["1", "Buat Bedeng Pekerja Dan Gudang", 21, "m²", 1_471_387.54, 21],
      ["2", "Papan Nama Proyek", 1, "bh", 1_544_551.07, 1],
      ["3", "Pagar Sementara", 100, "m¹", 375_994.58, 120],
      ["4", "Pembersihan Lahan", 200, "m²", 12_500, 150],
    ]],
    ["VII", "PEKERJAAN BANGUNAN KIOS PERBEKALAN", [
      ["5", "Pekerjaan Skonengan (Opening Kusen)", 29.88, "m¹", 75_180.75, 31.12],
    ]],
    // Kategori BARU di CCO-01: kolom MC-0 kosong.
    ["XIII", "PEKERJAAN PAGAR KELILING DAN SALURAN", [
      ["11", "Pekerjaan Skonengan", null, "m1", 75_180.75, 31.1],
    ]],
  ];
  let r = 14;
  for (const [kode, nama, items] of kategori) {
    ws.getRow(r).getCell(1).value = kode;
    ws.getRow(r).getCell(2).value = nama;
    r++;
    for (const [k, n, vol, sat, harga, volCco] of items) {
      const row = ws.getRow(r);
      row.getCell(1).value = k;
      row.getCell(2).value = n;
      row.getCell(6).value = sat;
      if (vol != null) {
        row.getCell(5).value = vol;
        row.getCell(11).value = harga;
        row.getCell(12).value = vol * harga;
        // G..J, M..P: HPS/penawaran/bobot lain – TERSEMBUNYI.
        for (const c of [7, 8, 9, 10, 13, 14, 15, 16]) row.getCell(c).value = SAMPAH;
        row.getCell(17).value = 1.2;
      }
      // TAMBAH/KURANG: tersembunyi di berkas asli – diisi SAMPAH bila tersembunyi.
      for (const c of [18, 19, 20, 21, 22, 23]) row.getCell(c).value = opts.tambahKurangTerlihat ? 0 : SAMPAH;
      row.getCell(24).value = volCco;
      row.getCell(25).value = harga;
      row.getCell(26).value = volCco * harga;
      row.getCell(27).value = 0.2;
      row.getCell(28).value = vol == null ? "TAMBAH" : "TETAP";
      r++;
    }
  }
  const tersembunyi = [7, 8, 9, 10, 13, 14, 15, 16, ...(opts.tambahKurangTerlihat ? [] : [18, 19, 20, 21, 22, 23])];
  for (const c of tersembunyi) ws.getColumn(c).hidden = true;
  return wb;
}

const itemDari = (wb: ExcelJS.Workbook) =>
  flattenParsedRab(parseHpsWorkbook(wb).parsed).filter((n) => n.kind === "item");

describe("CCO 1 Krakahan", () => {
  it("TAMBAH/KURANG tersembunyi tetap dikenali sebagai CCO – yang terbaca CCO-01, bukan MC-0", () => {
    const hasil = parseHpsWorkbook(berkasKrakahan());
    expect(hasil.priceColumn.label).toMatch(/CCO-01.*X\/Y\/Z/);
    expect(hasil.warnings.join(" ")).toMatch(/TAMBAH\/KURANG disembunyikan di Excel/);
    const items = flattenParsedRab(hasil.parsed).filter((n) => n.kind === "item");
    const pagar = items.find((n) => n.name === "Pagar Sementara")!;
    expect(pagar.volume).toBe(120);
    // Tidak satu angka pun dari kolom tersembunyi.
    expect(items.every((n) => n.amount < BigInt(SAMPAH))).toBe(true);
  });

  it("item baru adendum memakai harga satuan blok CCO-01 – tidak lagi kosong", () => {
    const items = itemDari(berkasKrakahan());
    const baru = items.find((n) => n.name === "Pekerjaan Skonengan")!;
    expect(baru.volume).toBe(31.1);
    expect(baru.unitPrice).toBe(75_180.75);
    expect(baru.amount).toBe(BigInt(Math.round(31.1 * 75_180.75)));
    expect(items.filter((n) => n.amount > 0n && n.unitPrice == null)).toEqual([]);
  });

  it("TAMBAH/KURANG terlihat: hasilnya sama", () => {
    const a = itemDari(berkasKrakahan()).map((n) => [n.name, n.volume, n.unitPrice, n.amount]);
    const b = itemDari(berkasKrakahan({ tambahKurangTerlihat: true })).map((n) => [n.name, n.volume, n.unitPrice, n.amount]);
    expect(b).toEqual(a);
  });

  it("pilihan kolom tangan menjangkau kolom sesudah X (Y, Z, AA, AB)", () => {
    const huruf = ringkasKolom(berkasKrakahan().getWorksheet("MC 0")!).map((k) => k.huruf);
    expect(huruf).toEqual(expect.arrayContaining(["X", "Y", "Z", "AA", "AB"]));
    // Kolom tersembunyi tetap tidak ditawarkan.
    expect(huruf).not.toContain("R");
    expect(huruf).not.toContain("G");
  });

  it("kolom sesudah X bisa dipilih tangan dan dibaca", () => {
    const hasil = parseHpsWorkbook(berkasKrakahan(), { vol: 24, unit: 6, price: 25, amount: 26 });
    const baru = flattenParsedRab(hasil.parsed).find((n) => n.name === "Pekerjaan Skonengan")!;
    expect(baru.unitPrice).toBe(75_180.75);
  });
});
