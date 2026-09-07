// BLOK HASIL = BLOK BERIKUTNYA SESUDAH TAMBAH/KURANG, BUKAN YANG PALING KANAN.
//
// Laporan user 2026-09-07 (MC 1 FINAL GEMPOLSEWU): berkas MC berisi ENAM blok
// sesudah "PEKERJAAN KURANG" —
//
//     CCO-01 · KET · KET · CCO-PRC · CCO-PERENCANA · BIAYA PELAKSANAAN
//
// Aturan lama "ambil blok TERBUKTI paling kanan" memilih CCO-PERENCANA, sebuah
// skenario perencana, lalu mengalikan volumenya dengan harga satuan blok dasar:
// Σ item 13,24 miliar untuk berkas yang menulis totalnya sendiri 3,67 miliar.
//
// Itu bentuk kesalahan yang paling berbahaya di berkas RAB: angkanya besar,
// rapi, dan sama sekali tidak terlihat salah. Hasil dari tambah/kurang adalah
// blok BERIKUTNYA; yang di kanannya skenario turunan yang bukan nilai kontrak.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { deteksiCco } from "@/lib/rab/cco-import";

/**
 * Sheet dengan DUA blok hasil yang sama-sama terbukti (`volume × harga =
 * jumlah`): CCO-01 (hasil sebenarnya) dan CCO-PERENCANA (skenario, angkanya
 * sengaja jauh lebih besar supaya salah pilih langsung kelihatan).
 */
function sheetDuaBlokHasil(): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.getRow(1).values = [
    "NO",
    "URAIAN",
    "MC - 0",
    "MC - 0",
    "MC - 0",
    "MC - 0",
    "PEKERJAAN TAMBAH",
    "PEKERJAAN TAMBAH",
    "PEKERJAAN KURANG",
    "PEKERJAAN KURANG",
    "CCO - 01",
    "CCO - 01",
    "CCO - PERENCANA",
    "CCO - PERENCANA",
  ];
  ws.getRow(2).values = [
    "NO",
    "URAIAN",
    "VOLUME",
    "SATUAN",
    "HARGA",
    "JUMLAH",
    "VOLUME",
    "JUMLAH",
    "VOLUME",
    "JUMLAH",
    "VOLUME",
    "JUMLAH",
    "VOLUME",
    "JUMLAH",
  ];

  const baris = [
    { kode: "1", nama: "Galian tanah", vol: 100, sat: "m³", hrg: 50_000, hasil: 120, prc: 400 },
    { kode: "2", nama: "Pasangan batu", vol: 40, sat: "m³", hrg: 900_000, hasil: 40, prc: 160 },
    { kode: "3", nama: "Beton K-250", vol: 25, sat: "m³", hrg: 1_400_000, hasil: 10, prc: 100 },
    { kode: "4", nama: "Bekisting", vol: 60, sat: "m²", hrg: 120_000, hasil: 75, prc: 240 },
    { kode: "5", nama: "Pembesian", vol: 1200, sat: "kg", hrg: 18_500, hasil: 1200, prc: 4800 },
  ];
  baris.forEach((b, i) => {
    ws.getRow(3 + i).values = [
      b.kode,
      b.nama,
      b.vol,
      b.sat,
      b.hrg,
      b.vol * b.hrg,
      Math.max(0, b.hasil - b.vol),
      Math.max(0, b.hasil - b.vol) * b.hrg,
      Math.max(0, b.vol - b.hasil),
      Math.max(0, b.vol - b.hasil) * b.hrg,
      b.hasil,
      b.hasil * b.hrg,
      b.prc,
      b.prc * b.hrg,
    ];
  });
  return ws;
}

describe("pemilihan blok hasil pada berkas tambah/kurang", () => {
  it("memilih CCO - 01, bukan CCO - PERENCANA di kanannya", () => {
    const peta = deteksiCco(sheetDuaBlokHasil());
    expect(peta, "berkas tambah/kurang tidak terdeteksi").not.toBeNull();
    expect(peta!.blokHasil.label).toBe("CCO - 01");
    // Kolom volume hasil = 11 (CCO-01), bukan 13 (CCO-PERENCANA).
    expect(peta!.col.vol).toBe(11);
    expect(peta!.col.amount).toBe(12);
    // Harga satuan tetap dari blok dasar — adendum tidak mengubah harga satuan.
    expect(peta!.col.price).toBe(5);
  });

  it("blok hasil KOSONG tetap dilewati, tidak dipaksa jadi hasil", () => {
    // Perilaku yang sudah ada sejak DRAFT_MC0_KEMANTREN: CCO-01 masih kosong
    // karena adendumnya belum dikerjakan, jadi yang berlaku blok dasar.
    const ws = sheetDuaBlokHasil();
    for (let r = 3; r <= 7; r++) {
      ws.getRow(r).getCell(11).value = null;
      ws.getRow(r).getCell(12).value = null;
      ws.getRow(r).getCell(13).value = null;
      ws.getRow(r).getCell(14).value = null;
    }
    const peta = deteksiCco(ws);
    expect(peta).not.toBeNull();
    expect(peta!.hasilDariDasar).toBe(true);
    expect(peta!.blokHasil.label).toBe("MC - 0");
  });
});
