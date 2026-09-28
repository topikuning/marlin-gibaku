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
// Yang dijaga: TIDAK SATU PUN angka dari kolom tersembunyi – kolom itu sengaja
// diisi angka yang salah di sini.
//
// DECISIONS 625 mencabut "harga satuan = jumlah ÷ volume" (623): *"siapa yang
// mengijinkan ini?"*. Bentuk Tegalsari (semua kolom harga tersembunyi) kini
// DITANYAKAN dengan menyebut kolom harga yang perlu ditampilkan. Ditambah dua
// berkas nyata 2026-09-27: Suradadi (harga satuan ada di blok CCO-01, baris
// penutup "II. PPN 11 % :" dst.) dan Pasir (dua kolom VOL – yang dipakai yang
// terbukti volume × harga = jumlah).
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHpsWorkbook } from "@/lib/rab/hps-parser";
import type { ParsedRabItem } from "@/lib/rab/parsed";

const SAMPAH = 999_999_999;

function berkasTegalsari(
  opts: { sembunyikanVolCco?: boolean; asemdoyong?: boolean; celah?: boolean } = {},
): ExcelJS.Workbook {
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
  } else if (opts.celah) {
    // Berkas MC1 Betah Walang: blok "MC - 0" = E..L, harga satuan I dan
    // jumlah K TERLIHAT, diapit kolom kosong-tersembunyi H dan J.
    for (let c = 5; c <= 12; c++) ws.getRow(14).getCell(c).value = "MC - 0";
    for (let i = 0; i < item.length; i++) {
      const [, , vol, , harga] = item[i]!;
      const row = ws.getRow(20 + i);
      row.getCell(9).value = harga;
      row.getCell(11).value = vol * harga;
      row.getCell(12).value = 1.5;
    }
    for (const c of [7, 8, 10]) ws.getColumn(c).hidden = true;
  } else for (const c of [7, 8, 9, 10, 11, 12]) ws.getColumn(c).hidden = true;
  if (opts.sembunyikanVolCco) ws.getColumn(20).hidden = true;
  return wb;
}

describe("CCO dengan kolom harga blok kontrak tersembunyi", () => {
  it("semua kolom harga tersembunyi → DITANYAKAN dengan menyebut kolomnya, harga tidak diturunkan", () => {
    expect(() => parseHpsWorkbook(berkasTegalsari())).toThrow(
      /harga satuannya disembunyikan \(kolom G, H, I, J, K, L\).*tidak menghitung harga satuan dari jumlah ÷ volume/,
    );
  });

  it("kolom volume CCO ikut disembunyikan → ditolak, TIDAK dibaca dari blok HPS/penawaran", () => {
    expect(() => parseHpsWorkbook(berkasTegalsari({ sembunyikanVolCco: true }))).toThrow(/berbentuk dokumen CCO/);
  });

  it("kolom tersembunyi DI TENGAH blok dasar tidak memotongnya – harga satuan yang terlihat dipakai", () => {
    const h = parseHpsWorkbook(berkasTegalsari({ celah: true }));
    const item = h.parsed.categories[0]!.direct_items;
    expect(item.map((i) => i.volume)).toEqual([50, 4.5, 1, 4.5, 100, 0, 2]);
    expect(item.map((i) => i.unit_price)).toEqual([1_314_766.94, 2_500_000, 1_544_551.07, 1_000_000, 375_994.58, 12_500, 25_000_000]);
    expect(h.warnings.join(" ")).not.toMatch(/÷/);
    expect(JSON.stringify(h.parsed)).not.toContain(String(SAMPAH));
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

const semuaItem = (h: ReturnType<typeof parseHpsWorkbook>): ParsedRabItem[] =>
  h.parsed.categories.flatMap((c) => [...c.direct_items, ...c.subcategories.flatMap((s) => s.items)]);

/** Bentuk sheet "CCO1" Suradadi: harga satuan ADA di blok CCO-01 (R/S/T). */
function berkasSuradadi(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CCO1");
  const grup = ["NO", "ITEM PEKERJAAN", "ITEM PEKERJAAN", "ITEM PEKERJAAN", "VOLUME", "SAT", "HARGA SATUAN",
    "JUMLAH HARGA", "NILAI TKDN", "NILAI KDN", "BOBOT", "PEKERJAAN TAMBAH", "PEKERJAAN TAMBAH", "PEKERJAAN TAMBAH",
    "PEKERJAAN KURANG", "PEKERJAAN KURANG", "PEKERJAAN KURANG", "CCO-01", "CCO-01", "CCO-01", "CCO-01", "KETERANGAN"];
  ws.getRow(10).values = grup;
  ws.getRow(11).values = grup.map((g) => (g === "NILAI TKDN" || g === "NILAI KDN" ? null : g));
  ws.getRow(12).values = ["NO", "ITEM PEKERJAAN", "ITEM PEKERJAAN", "ITEM PEKERJAAN", "VOLUME", "SAT",
    "HARGA SATUAN", "JUMLAH HARGA", "NILAI TKDN", "NILAI KDN", "BOBOT", "VOLUME", "JUMLAH HARGA", "BOBOT",
    "VOLUME", "JUMLAH HARGA", "BOBOT", "VOLUME", "HARGA SATUAN", "JUMLAH HARGA", "BOBOT", "KETERANGAN"];
  // [kode, nama, vol kontrak, sat, harga, vol cco]
  const item: [string, string, number, string, number, number][] = [
    ["1", "Buat Bedeng Pekerja Dan Gudang", 50, "m²", 1_331_238.61, 50],
    ["2", "Pekerjaan Sewa Rumah", 6, "bln", 2_500_000, 4.5],
    ["3", "Pekerjaan Urugan Tanah", 1754, "m³", 185_212.63, 1202.59115],
    ["4", "Pek. Pemadatan", 1754, "m³", 146_283.35, 1202.59115],
  ];
  ws.getRow(14).values = ["I", "PEKERJAAN PERSIAPAN"];
  let r = 15;
  let total = 0;
  for (const [kode, nama, vol, sat, harga, volCco] of item) {
    const kurang = Math.max(0, vol - volCco);
    total += volCco * harga;
    ws.getRow(r++).values = [kode, nama, null, null, vol, sat, harga, vol * harga, SAMPAH, SAMPAH, 1.7,
      null, null, null, kurang || null, kurang ? kurang * harga : null, null,
      volCco, harga, volCco * harga, 1.7, SAMPAH];
  }
  const penutup = (label: string, nilai: number) => {
    const row = ws.getRow(r++);
    row.getCell(4).value = label;
    row.getCell(8).value = nilai;
    row.getCell(20).value = nilai;
  };
  penutup("JUMLAH :", total);
  penutup("JUMLAH TOTAL:", total);
  penutup("II. PPN 11 % :", total * 0.11);
  penutup("III. TOTAL I + II :", total * 1.11);
  penutup("IV. DIBULATKAN :", Math.floor(total * 1.11 / 1000) * 1000);
  for (const c of [9, 10, 22]) ws.getColumn(c).hidden = true;
  return wb;
}

describe("CCO Suradadi: harga satuan di blok CCO, baris penutup bernomor", () => {
  it("volume, harga satuan, dan jumlah dari blok CCO-01; baris PPN/TOTAL/DIBULATKAN bukan item", () => {
    const h = parseHpsWorkbook(berkasSuradadi());
    const item = semuaItem(h);
    expect(item.map((i) => i.volume)).toEqual([50, 4.5, 1202.59115, 1202.59115]);
    expect(item.map((i) => i.unit_price)).toEqual([1_331_238.61, 2_500_000, 185_212.63, 146_283.35]);
    expect(item[1]).toMatchObject({ total_price: 11_250_000 });
    expect(item.some((i) => /PPN|TOTAL|DIBULATKAN/.test(i.name))).toBe(false);
    expect(JSON.stringify(h.parsed)).not.toContain(String(SAMPAH));
  });
});

/** Bentuk sheet "RAB" Pasir: dua kolom VOL (kontrak & CCO-1), satu harga. */
function berkasPasir(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.getRow(10).values = ["NO", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "JENIS PEKERJAAN", "VOL KONTRAK",
    "VOL CCO - 1", "SAT", "HARGA SATUAN", "JUMLAH HARGA", "NILAI TKDN", "NILAI KDN", "BOBOT"];
  ws.getRow(12).values = ["I", "PEKERJAAN PERSIAPAN"];
  ws.getRow(13).values = ["1", "Buat Bedeng Pekerja", null, null, 50, 50, "m²", 2_564_609.15, 128_230_457.5, SAMPAH, SAMPAH, 3.2];
  ws.getRow(14).values = ["2", "Pekerjaan Sewa Rumah", null, null, 6, 4.5, "bln", 2_500_000, 11_250_000, SAMPAH, SAMPAH, 0.3];
  ws.getRow(15).values = ["II", "PEKERJAAN REVETMENT"];
  ws.getRow(16).values = ["1", "Pasangan Batu Kosong", null, null, 320, 0, "m³", 950_000, 0, SAMPAH, SAMPAH, 0];
  ws.getRow(17).values = ["2", "Galian Tanah", null, null, 410, 0, "m³", 85_000, 0, SAMPAH, SAMPAH, 0];
  for (const c of [10, 11]) ws.getColumn(c).hidden = true;
  return wb;
}

describe("Pasir: dua kolom VOL", () => {
  it("volume dari kolom yang TERBUKTI volume × harga = jumlah (VOL CCO - 1), revetment 0 tetap 0", () => {
    const h = parseHpsWorkbook(berkasPasir());
    const [persiapan, revetment] = h.parsed.categories;
    expect(persiapan!.direct_items.map((i) => i.volume)).toEqual([50, 4.5]);
    expect(revetment!.direct_items.map((i) => [i.volume, i.total_price])).toEqual([[0, 0], [0, 0]]);
    expect(JSON.stringify(h.parsed)).not.toContain(String(SAMPAH));
  });
});
