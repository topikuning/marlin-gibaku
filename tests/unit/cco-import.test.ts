// BERKAS TAMBAH/KURANG KKP DIBACA APA ADANYA (DECISIONS 296).
//
// Permintaan user 2026-08-07: *"itu adalah format dari kkp, bisa jadi tim
// terlanjur mengerjakan di file seperti itu … jadi kamu harus lebih luwes."*
//
// Diuji dari BENTUK berkas, bukan dari dokumen kontrak asli: yang menentukan
// benar-salah di sini justru kemampuan mengabaikan nama kolom.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { deteksiCco, hitungPerubahan } from "@/lib/rab/cco-import";

/**
 * Susun sheet tambah/kurang. `labels` = label blok kiri→kanan, dan datanya
 * dibuat konsisten (jumlah = volume × harga) supaya pembuktian aritmetika
 * punya bahan.
 */
function sheetCco(opts: {
  labelDasar: string;
  labelHasil: string;
  /** Sisipkan kolom REALISASI di blok dasar (bentuk berkas CCO-01 KKP). */
  realisasi?: boolean;
}): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  const D = opts.labelDasar;
  const H = opts.labelHasil;
  // Kolom: 1 NO | 2 URAIAN | dasar… | tambah(3) | kurang(3) | hasil(2)
  const dasar = opts.realisasi
    ? [D, D, D, D, D] // VOLUME REALISASI SATUAN HARGA JUMLAH
    : [D, D, D, D]; //  VOLUME SATUAN HARGA JUMLAH
  const grup = ["NO", "URAIAN", ...dasar, "PEKERJAAN TAMBAH", "PEKERJAAN TAMBAH", "PEKERJAAN KURANG", "PEKERJAAN KURANG", H, H];
  ws.getRow(1).values = grup;
  const sub = opts.realisasi
    ? ["NO", "URAIAN", "VOLUME", "REALISASI", "SATUAN", "HARGA", "JUMLAH", "VOLUME", "JUMLAH", "VOLUME", "JUMLAH", "VOLUME", "JUMLAH"]
    : ["NO", "URAIAN", "VOLUME", "SATUAN", "HARGA", "JUMLAH", "VOLUME", "JUMLAH", "VOLUME", "JUMLAH", "VOLUME", "JUMLAH"];
  ws.getRow(2).values = sub;

  const baris = [
    { kode: "1", nama: "Galian tanah", volD: 100, sat: "m³", hrg: 50_000, volH: 120 },
    { kode: "2", nama: "Pasangan batu", volD: 40, sat: "m³", hrg: 900_000, volH: 40 },
    { kode: "3", nama: "Beton K-250", volD: 25, sat: "m³", hrg: 1_400_000, volH: 10 },
    { kode: "4", nama: "Bekisting", volD: 60, sat: "m²", hrg: 120_000, volH: 75 },
    { kode: "5", nama: "Pembesian", volD: 1200, sat: "kg", hrg: 18_500, volH: 1200 },
  ];
  baris.forEach((b, i) => {
    const r = ws.getRow(3 + i);
    const v = opts.realisasi
      ? [b.kode, b.nama, b.volD, b.volD, b.sat, b.hrg, b.volD * b.hrg, "", "", "", "", b.volH, b.volH * b.hrg]
      : [b.kode, b.nama, b.volD, b.sat, b.hrg, b.volD * b.hrg, "", "", "", "", b.volH, b.volH * b.hrg];
    r.values = v;
  });
  return ws;
}

describe("deteksi blok tambah/kurang", () => {
  it("volume diambil dari blok HASIL, bukan blok dasar", () => {
    const ws = sheetCco({ labelDasar: "RAB", labelHasil: "MC 0" });
    const peta = deteksiCco(ws)!;
    expect(peta).not.toBeNull();
    expect(peta.blokDasar.label).toBe("RAB");
    expect(peta.blokHasil.label).toBe("MC 0");
    // Kolom volume hasil ≠ kolom volume dasar.
    expect(peta.col.vol).not.toBe(peta.volDasar);
    expect(ws.getRow(3).getCell(peta.col.vol).value).toBe(120); // volH baris 1
    expect(ws.getRow(3).getCell(peta.volDasar).value).toBe(100); // volD baris 1
  });

  it("LABEL TIDAK MENENTUKAN — 'MC - 0' sebagai blok dasar tidak ikut terambil", () => {
    // Inti jebakannya: di satu berkas KKP "MC-0" adalah HASIL, di berkas lain
    // ia KEADAAN AWAL. Menyimpulkan peran dari namanya pasti salah di salah
    // satunya.
    const ws = sheetCco({ labelDasar: "MC - 0", labelHasil: "CCO - 01", realisasi: true });
    const peta = deteksiCco(ws)!;
    expect(peta.blokDasar.label).toBe("MC - 0");
    expect(peta.blokHasil.label).toBe("CCO - 01");
    expect(ws.getRow(3).getCell(peta.col.vol).value).toBe(120);
  });

  it("kolom REALISASI di blok dasar tidak tertukar jadi volume/harga", () => {
    const ws = sheetCco({ labelDasar: "MC - 0", labelHasil: "CCO - 01", realisasi: true });
    const peta = deteksiCco(ws)!;
    expect(ws.getRow(3).getCell(peta.col.price).value).toBe(50_000);
    expect(ws.getRow(3).getCell(peta.col.unit).value).toBe("m³");
  });

  it("satuan & harga satuan diambil dari blok DASAR — adendum mengubah volume, bukan harga", () => {
    const ws = sheetCco({ labelDasar: "RAB", labelHasil: "MC 0" });
    const peta = deteksiCco(ws)!;
    expect(peta.col.price).toBeGreaterThanOrEqual(peta.blokDasar.mulai);
    expect(peta.col.price).toBeLessThanOrEqual(peta.blokDasar.akhir);
    expect(peta.col.unit).toBeGreaterThanOrEqual(peta.blokDasar.mulai);
    expect(peta.col.unit).toBeLessThanOrEqual(peta.blokDasar.akhir);
  });

  it("menghitung berapa item yang volumenya berubah", () => {
    // Ini yang menyelamatkan adendum NETRAL NILAI: total kedua blok bisa sama
    // persis sementara ratusan item berbeda, jadi cek total tidak akan pernah
    // menangkap salah-baca blok.
    const ws = sheetCco({ labelDasar: "RAB", labelHasil: "MC 0" });
    expect(hitungPerubahan(ws, deteksiCco(ws)!)).toEqual({ berubah: 3, total: 5 });
  });
});

describe("yang BUKAN berkas tambah/kurang tidak disentuh", () => {
  it("RAB biasa → null, biar jalur deteksi header yang menanganinya", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("RAB");
    ws.getRow(1).values = ["NO", "URAIAN", "VOLUME", "SATUAN", "HARGA SATUAN", "JUMLAH HARGA"];
    ws.getRow(2).values = ["1", "Galian", 10, "m³", 50000, 500000];
    expect(deteksiCco(ws)).toBeNull();
  });

  it("ada TAMBAH tapi tanpa KURANG → bukan bentuk ini", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("X");
    ws.getRow(1).values = ["NO", "URAIAN", "RAB", "PEKERJAAN TAMBAH"];
    expect(deteksiCco(ws)).toBeNull();
  });

  it("bentuknya benar tapi angkanya tidak membuktikan apa pun → null, bukan tebakan", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("X");
    ws.getRow(1).values = ["NO", "URAIAN", "RAB", "RAB", "PEKERJAAN TAMBAH", "PEKERJAAN KURANG", "MC 0", "MC 0"];
    for (let i = 0; i < 5; i++) ws.getRow(2 + i).values = ["1", "x", 1, 2, 3, 4, 5, 6];
    expect(deteksiCco(ws)).toBeNull();
  });
});
