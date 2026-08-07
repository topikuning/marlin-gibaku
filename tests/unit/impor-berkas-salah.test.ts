// BERKAS SALAH HARUS DITOLAK DENGAN PESAN YANG BISA DITINDAKLANJUTI.
//
// Laporan user 2026-08-07: mengimpor `CCO01_<lokasi>.xlsx` ke draft adendum.
// Berkas tambah/kurang KKP kini DITERIMA (DECISIONS 296); pesan ini tersisa
// untuk berkas yang bentuknya mirip tapi angkanya tidak terbukti. Pesan lama, "Sheet RAB tidak ditemukan di file HPS", benar secara
// teknis tapi tidak bisa ditindaklanjuti: orang yang baru saja mengunduh
// berkas itu DARI MARLIN wajar mengira itulah yang harus dikembalikan.
//
// Diuji dari BENTUKNYA (nama sheet), bukan dari berkas contoh: itu memang yang
// dipakai kode untuk mengenali, dan dokumen kontrak asli tidak perlu ikut
// tersimpan di repo.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseHpsWorkbook } from "@/lib/rab/hps-parser";

function workbookDenganSheet(...nama: string[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const n of nama) wb.addWorksheet(n);
  return wb;
}

describe("sheet RAB tidak ada", () => {
  it("dokumen CCO terbitan MARLIN dikenali dan diarahkan ke Template Adendum", () => {
    const wb = workbookDenganSheet("CCO-01");
    expect(() => parseHpsWorkbook(wb)).toThrow(/volume × harga satuan tidak sama dengan jumlah harga/);
    // Pesannya harus menyebut JALAN KELUARNYA, bukan cuma menyalahkan berkas.
    expect(() => parseHpsWorkbook(wb)).toThrow(/Template Adendum/);
  });

  it("variasi penulisan nomor CCO tetap dikenali", () => {
    for (const n of ["CCO - 01", "CCO01", "cco-2"]) {
      expect(() => parseHpsWorkbook(workbookDenganSheet(n))).toThrow(/berbentuk dokumen CCO/);
    }
  });

  it("berkas asing lain menyebut sheet yang ADA — supaya user tak menebak", () => {
    const wb = workbookDenganSheet("Sheet1", "Rekap Bulanan");
    expect(() => parseHpsWorkbook(wb)).toThrow(/Sheet1, Rekap Bulanan/);
  });

  it("sheet bernama RAB tetap diterima — penolakan tidak boleh melebar", () => {
    // Batasnya penting: pesan bagus tidak ada gunanya kalau berkas yang SAH
    // ikut ditolak. Sheet RAB kosong lolos pemeriksaan nama ini dan gagal
    // (kalau gagal) karena alasan lain, bukan karena namanya.
    const wb = workbookDenganSheet("RAB");
    expect(() => parseHpsWorkbook(wb)).not.toThrow(/dokumen CCO|Sheet "RAB" tidak ditemukan/);
  });
});
