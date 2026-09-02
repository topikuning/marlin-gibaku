// KOLOM "SATUAN" TIDAK BOLEH TERPILIH SEBAGAI KOLOM HARGA SATUAN.
//
// Temuan audit 2026-09-01. Penyaringnya berbunyi:
//
//   if (/^VOL/.test(s) || /^SAT\b/.test(s)) return false;
//   return /HARGA|NILAI|SATUAN/.test(s);
//
// `/^SAT\b/` TIDAK PERNAH cocok dengan "SATUAN" - "\b" menuntut batas kata
// sesudah "SAT", padahal huruf berikutnya "U" juga karakter kata. Jadi header
// bertuliskan SATUAN lolos penyaring, lalu ditangkap `/HARGA|NILAI|SATUAN/`,
// dan karena pemindaian dari kiri ia ditemukan SEBELUM kolom "HARGA SATUAN".
//
// Akibatnya harga dibaca dari sel satuan: "m3" jadi harga 3, "m2" jadi 2,
// "bh"/"ls"/"kg" jadi kosong. Jaring cek-silang butuh 20 baris berangka
// lengkap, dan satuan tanpa digit membuat baris tidak ikut dihitung - jadi RAB
// bersatuan "bh/ls/kg" lolos tanpa satu peringatan pun.
//
// Tidak ada satu pun uji lama memakai ejaan "SATUAN"; semuanya "VOL"/"SAT".
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { detectColumns } from "@/lib/rab/hps-parser";

/** Sheet dengan header dua baris seperti berkas RAB nyata. */
async function sheet(headers: string[]): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.addRow(headers);
  ws.addRow([]);
  // Beberapa baris data supaya deteksi punya bahan.
  ws.addRow(["1", "Pekerjaan Galian", 10, "m3", 100_000, 1_000_000]);
  ws.addRow(["2", "Pekerjaan Urugan", 5, "m3", 200_000, 1_000_000]);
  return ws;
}

describe("ejaan kolom satuan tidak menggeser kolom harga", () => {
  const HARGA_KE = 5;
  const SATUAN_KE = 4;

  it("SATUAN (ejaan penuh) - kolom harga tetap kolom HARGA SATUAN", async () => {
    const ws = await sheet(["NO", "URAIAN", "VOLUME", "SATUAN", "HARGA SATUAN (Rp)", "JUMLAH HARGA (Rp)"]);
    const d = detectColumns(ws);
    expect(d.col.unit).toBe(SATUAN_KE);
    expect(d.col.price).toBe(HARGA_KE);
    expect(d.col.price).not.toBe(d.col.unit);
  });

  it("Satuan (huruf kecil) - sama", async () => {
    const ws = await sheet(["No", "Uraian", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"]);
    const d = detectColumns(ws);
    expect(d.col.price).toBe(HARGA_KE);
    expect(d.col.price).not.toBe(d.col.unit);
  });

  it("SAT (singkatan) - tetap benar seperti sebelumnya", async () => {
    const ws = await sheet(["NO", "URAIAN", "VOLUME", "SAT", "HARGA SATUAN", "JUMLAH HARGA"]);
    const d = detectColumns(ws);
    expect(d.col.price).toBe(HARGA_KE);
  });

  it("SATUAN tanpa kata HARGA di kolom berikutnya - harga tetap bukan kolom satuan", async () => {
    const ws = await sheet(["NO", "URAIAN", "VOLUME", "SATUAN", "HARGA", "JUMLAH"]);
    const d = detectColumns(ws);
    expect(d.col.price).toBe(HARGA_KE);
    expect(d.col.price).not.toBe(d.col.unit);
  });
});
