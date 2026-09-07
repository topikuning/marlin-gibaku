// LABEL DI SAMPUL TIDAK BOLEH DIANGGAP HEADER TABEL.
//
// Laporan user 2026-09-07 (MC 1 FINAL GEMPOLSEWU, 4,3 MB): berkas RAB senilai
// Rp 3,67 miliar terbaca sebagai *"1 item pekerjaan · Rp 1"*.
//
// Rantai sebabnya satu baris di blok identitas:
//
//     B17: "JENIS PENGADAAN"   E17: "JASA KONSTRUKSI"
//
// Kata "JENIS" ada di `URAIAN_RE`, jadi baris sampul itu dikira baris header
// tabel dan kolom uraian ditetapkan B — delapan baris di atas header yang
// sebenarnya. Batas kanan pencarian kolom kode ikut menyempit jadi "< 2",
// sehingga label "NO" di kolom B tidak pernah terlihat dan kolom kode jatuh ke
// kolom A yang kosong. Sesudah itu semuanya runtuh: kode kosong, NAMA pekerjaan
// terbaca sebagai nomor ("1", "2", "6.1."), nol item masuk pohon.
//
// Yang dijaga di sini BENTUK kegagalannya, bukan berkas aslinya: sebuah berkas
// kecil dengan blok identitas yang sama persis pemicunya.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { detectCodeColumn, detectColumns, parseHpsWorkbook } from "@/lib/rab/hps-parser";

/**
 * Tata letak yang menirukan berkas aslinya: kode di B, uraian di C, dan blok
 * identitas ber-"JENIS PENGADAAN" di atas headernya.
 */
async function berkasBerSampul(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.addRow([]);
  ws.addRow(["", "PROGRAM", "", ":", "MODERNISASI SARANA"]);
  ws.addRow(["", "KEGIATAN", "", ":", "PENGEMBANGAN FASILITAS"]);
  // ↓ pemicunya: "JENIS PENGADAAN" cocok dengan URAIAN_RE.
  ws.addRow(["", "JENIS PENGADAAN", "", ":", "JASA KONSTRUKSI"]);
  ws.addRow(["", "NAMA PAKET", "", ":", "PEMBANGUNAN KAMPUNG NELAYAN"]);
  ws.addRow([]);
  ws.addRow(["", "NO", "URAIAN PEKERJAAN", "", "", "VOLUME", "SATUAN", "HARGA SATUAN", "JUMLAH HARGA"]);
  ws.addRow(["", "I", "PEKERJAAN PERSIAPAN"]);
  ws.addRow(["", "1", "Buat Bedeng Pekerja", "", "", 50, "m2", 1_720_171, 86_008_550]);
  ws.addRow(["", "2", "Papan Nama Proyek", "", "", 1, "bh", 2_120_320, 2_120_320]);
  ws.addRow(["", "", "JUMLAH", "", "", null, null, null, 88_128_870]);
  return wb;
}

describe("blok identitas di sampul", () => {
  it("kolom kode tetap B, bukan A yang kosong", async () => {
    const wb = await berkasBerSampul();
    const ws = wb.getWorksheet("RAB")!;
    const { col } = detectColumns(ws);
    // B = 2. Sebelum perbaikan nilainya 1 (kolom A), dan seluruh bacaan runtuh.
    expect(detectCodeColumn(ws, col.vol)).toBe(2);
  });

  it("itemnya terbaca beserta nilainya, bukan nol item", async () => {
    const { parsed } = parseHpsWorkbook(await berkasBerSampul());
    const kat = parsed.categories;
    expect(kat).toHaveLength(1);
    expect(kat[0].name).toBe("PEKERJAAN PERSIAPAN");
    const item = kat[0].direct_items;
    expect(item).toHaveLength(2);
    // Nama pekerjaan, BUKAN nomornya — inilah yang dulu tertukar.
    expect(item[0].name).toBe("Buat Bedeng Pekerja");
    expect(item[0].code).toBe("1");
    expect(item[0].volume).toBe(50);
    expect(item[0].unit).toBe("m2");
    expect(item[0].unit_price).toBe(1_720_171);
    expect(parsed.total).toBe(88_128_870);
  });
});

describe("bacaan yang mustahil ditolak, bukan diteruskan", () => {
  /**
   * Berkas yang menulis totalnya sendiri jauh DI ATAS Σ item yang terbaca.
   * Kandidat semacam itu tidak mungkin subtotal kategori — subtotal, menurut
   * bentuknya, selalu lebih kecil dari jumlah seluruh item.
   */
  async function berkasTotalJauh(jumlahItem: number, totalDitulis: number) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("RAB");
    ws.addRow(["NO", "URAIAN PEKERJAAN", "VOLUME", "SATUAN", "HARGA SATUAN", "JUMLAH HARGA"]);
    ws.addRow(["I", "PEKERJAAN PERSIAPAN"]);
    ws.addRow(["1", "Galian Tanah", 1, "ls", jumlahItem, jumlahItem]);
    ws.addRow(["", "JUMLAH", null, null, null, totalDitulis]);
    return wb;
  }

  it("Σ item < 1% dari total yang ditulis berkas: DITOLAK", async () => {
    // Bentuk persis kegagalan yang dilaporkan: berkas 3,67 miliar tampil
    // sebagai Rp 1. Angka seperti itu tidak boleh sampai ke layar persetujuan
    // dengan tanda seru kecil di bawahnya.
    const wb = await berkasTotalJauh(1, 3_669_794_881);
    expect(() => parseHpsWorkbook(wb)).toThrow(/tidak terbaca sebagai RAB/);
  });

  it("selisih besar tapi masih masuk akal: BERBUNYI, tidak ditolak", async () => {
    const { warnings, parsed } = parseHpsWorkbook(await berkasTotalJauh(60_000_000, 100_000_000));
    expect(parsed.total).toBe(60_000_000);
    expect(warnings.some((w) => w.includes("total yang DITULIS berkas"))).toBe(true);
  });
});
