import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));
const { bacaSheet } = await import("@/lib/daily-report/rekap-matriks/baca");

/**
 * PEMBACA SHEET "REKAP HARIAN" (DECISIONS 782) – workbook buatan yang meniru
 * jebakan berkas asli (DESA IYOK/JIKO/BUYAT 1): judul bertingkat
 * (Tanggal/Bulan/Minggu/Hari) dengan sel judul yang digabung ke bawah, kolom
 * harian yang disembunyikan sehingga yang terlihat "lompat", nama pekerjaan di
 * dua kolom, angka 0, baris tersembunyi.
 */
function sheet() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("REKAP HARIAN");
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const tanggal = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
  // Kolom: C NO, D Uraian, E nama, H Sat, I Volume Kontrak, O.. tanggal.
  ws.getCell("C19").value = "NO";
  ws.getCell("D19").value = "Uraian Pekerjaan";
  ws.getCell("H19").value = "Sat";
  ws.getCell("I19").value = "Volume Kontrak";
  ws.getCell("N19").value = "Tanggal";
  ws.mergeCells("C19:C22");
  ws.mergeCells("D19:G22");
  ws.mergeCells("H19:H22");
  tanggal.forEach((t, i) => {
    ws.getRow(19).getCell(15 + i).value = d(t);
    ws.getRow(20).getCell(15 + i).value = d(t); // Bulan
    ws.getRow(21).getCell(15 + i).value = 1; // Minggu – bukan volume
    ws.getRow(22).getCell(15 + i).value = d(t); // Hari
  });
  ws.getCell("N21").value = "Minggu";
  // Yang terlihat hanya 20 dan 25 Okt ("kolom lompat").
  for (let c = 16; c <= 19; c++) ws.getColumn(c).hidden = true;
  const baris = (r: number, kode: string | number, nama: string, sat: string | null, vol: number | null, isi: Record<number, unknown>) => {
    ws.getCell(`C${r}`).value = kode;
    ws.getCell(`E${r}`).value = nama;
    if (sat != null) ws.getCell(`H${r}`).value = sat;
    if (vol != null) ws.getCell(`I${r}`).value = vol;
    for (const [c, v] of Object.entries(isi)) ws.getRow(r).getCell(Number(c)).value = v as ExcelJS.CellValue;
  };
  baris(26, "I", "PEKERJAAN PERSIAPAN", null, null, {});
  baris(27, "Buat Bedeng Pekerja", "Buat Bedeng Pekerja", "m²", 50, { 15: 25, 20: 10, 16: 0 });
  baris(28, 2, "Galian Tanah", "m3", 30, { 15: 0, 17: 7 }); // angka hanya di kolom tersembunyi
  baris(29, "a", "Papan Nama", "bh", 1, { 20: "satu" }); // teks di sel tanggal
  baris(30, "b", "Pagar Sementara", "m'", 100, { 15: 40 });
  ws.getRow(30).hidden = true; // baris tersembunyi berisi angka
  baris(31, "c", "Listrik Kerja", "bln", 3, { 20: { formula: "I31", result: 3 } });
  return ws;
}

describe("bacaSheet – REKAP HARIAN", () => {
  const r = bacaSheet(sheet());

  it("hanya kolom tanggal yang terlihat yang dibaca; judul bertingkat dilewati", () => {
    expect(r.kolomTanggal.map((k) => `${k.huruf}=${k.tanggal}`)).toEqual(["O=2026-10-20", "T=2026-10-25"]);
    expect(r.baris.find((b) => /minggu|uraian/i.test(b.nama))).toBeUndefined();
    expect([r.awalPeriode, r.akhirPeriode]).toEqual(["2026-10-20", "2026-10-25"]);
  });

  it("nama dari kolom paling kanan, kode dari kolom NO bila pendek; angka 0 bukan volume; hasil rumus dibaca", () => {
    const p = (row: number) => r.baris.find((b) => b.excelRow === row)!;
    expect(p(26)).toMatchObject({ kode: "I", nama: "PEKERJAAN PERSIAPAN", judul: true, sel: [] });
    expect(p(27)).toMatchObject({ kode: "", nama: "Buat Bedeng Pekerja", satuan: "m²", volumeKontrak: 50 });
    expect(p(27).sel.map((s) => [s.tanggal, s.volume])).toEqual([
      ["2026-10-20", 25],
      ["2026-10-25", 10],
    ]);
    expect(p(31).sel.map((s) => [s.tanggal, s.volume])).toEqual([["2026-10-25", 3]]);
  });

  it("angka di kolom tersembunyi, baris tersembunyi, dan teks di sel tanggal TIDAK dibaca tetapi disebut", () => {
    expect(r.baris.find((b) => b.excelRow === 28)!.sel).toEqual([]);
    expect(r.tersembunyi).toEqual([{ tanggal: "2026-10-22", sel: 1 }]);
    expect(r.baris.some((b) => b.excelRow === 30)).toBe(false);
    expect(r.barisTersembunyi).toEqual([30]);
    expect(r.teksDiSelTanggal).toEqual([{ excelRow: 29, kolom: "T", isi: "satu" }]);
  });
});
