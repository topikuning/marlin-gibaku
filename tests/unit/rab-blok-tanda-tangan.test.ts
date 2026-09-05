// NOMOR INDUK PEGAWAI BUKAN NILAI PEKERJAAN.
//
// Laporan user 2026-09-05 atas berkas MC-0 Pasar Banggi: nilai kontrak terbaca
// Rp 199.106.207.887.358.100 – dua ratus ribu triliun untuk pekerjaan yang
// nilainya enam miliar, dan seluruh kelebihan itu menumpuk di satu kategori
// terakhir (XVIII PEKERJAAN BANGUNAN IPAL BIOTECH).
//
// Sebabnya SATU sel di blok tanda tangan: "NIP 199106202015031001". Pembaca
// angka lama membuang semua huruf dari teks sel, jadi nomor induk pegawai
// berubah menjadi angka; barisnya sendiri ("Oc Team Leader", tanpa kode) masuk
// sebagai baris pekerjaan tak berinduk.
//
// Dua lapis dijaga di sini, dan keduanya perlu: yang satu menolak SEL-nya,
// yang lain menghentikan pembacaan sebelum blok tanda tangan sempat dibaca.
// Lapis kedua tidak berlebihan – blok tanda tangan juga memuat sel yang MEMANG
// angka (tanggal, nomor SK, nominal honor), dan tak satu pun dari itu pekerjaan.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHpsWorkbook } from "@/lib/rab/hps-parser";
import { bacaAngkaLokal } from "@/lib/rab/angka-lokal";

type Baris = (string | number | null)[];

async function berkas(penutup: Baris[]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.addRow(["NAMA PROYEK", "", ": Uji Tanda Tangan"]);
  ws.addRow(["NO", "URAIAN PEKERJAAN", "VOLUME", "SATUAN", "HARGA SATUAN (Rp)", "JUMLAH HARGA (Rp)"]);
  ws.addRow(["I", "PEKERJAAN PERSIAPAN", null, null, null, null]);
  ws.addRow(["1", "Galian Tanah", 10, "m3", 1_000_000, 10_000_000]);
  ws.addRow(["2", "Urugan Pasir", 5, "m3", 1_000_000, 5_000_000]);
  ws.addRow(["", "JUMLAH", null, null, null, 15_000_000]);
  for (const b of penutup) ws.addRow(b);
  return wb;
}

const total = async (penutup: Baris[]) => (await parseHpsWorkbook(await berkas(penutup))).parsed.total;

/* ── Lapis 1: sel bercampur huruf bukan angka ────────────────────────────── */

describe("pembaca angka: teks yang kebetulan mengandung digit", () => {
  it("NIP DITOLAK – bukan angka pekerjaan", () => {
    expect(bacaAngkaLokal("NIP 199106202015031001")).toBeNull();
    expect(bacaAngkaLokal("NIP. 19910620 201503 1 001")).toBeNull();
  });

  it("teks berlabel lain juga ditolak", () => {
    expect(bacaAngkaLokal("No. 12")).toBeNull();
    expect(bacaAngkaLokal("3 m³")).toBeNull();
    expect(bacaAngkaLokal("Termin 2")).toBeNull();
    expect(bacaAngkaLokal("Rembang, 02 Agustus 2026")).toBeNull();
  });

  it("angka yang sah TIDAK ikut ditolak – ini bukan pengetatan buta", () => {
    expect(bacaAngkaLokal("1.500.000,50")).toBe(1_500_000.5);
    expect(bacaAngkaLokal("Rp 1.500.000")).toBe(1_500_000);
    expect(bacaAngkaLokal("Rp. 1.500.000")).toBe(1_500_000);
    // Aturan satu-titik-sebagai-desimal (lihat angka-lokal.ts) tidak disentuh
    // perbaikan ini: "(2.000)" tetap −2, bukan −2000.
    expect(bacaAngkaLokal("(2.000,00)")).toBe(-2000);
    expect(bacaAngkaLokal("-1.234,5")).toBe(-1234.5);
    expect(bacaAngkaLokal("12,5%")).toBe(12.5);
    expect(bacaAngkaLokal(45.7)).toBe(45.7);
  });
});

/* ── Lapis 2: tabel berakhir di blok tanda tangan ────────────────────────── */

describe("pembacaan berhenti di blok tanda tangan", () => {
  const NIP: Baris = ["", "Oc Team Leader", null, null, null, "NIP 199106202015031001"];

  it("BUKTI SEBAB + perbaikannya: baris NIP tidak menggelembungkan total", async () => {
    expect(await total([["", "Diperiksa Oleh :"], ["", "Any Salindri"], NIP])).toBe(15_000_000);
  });

  it("blok tanda tangan berangka pun tidak masuk – berhenti, bukan disaring", async () => {
    // Nominal di blok tanda tangan (mis. honor, nomor SK) lolos lapis pertama
    // karena ia memang angka; yang menahannya adalah penghentian pembacaan.
    const t = await total([
      ["", "Mengetahui"],
      ["", "Pejabat Pembuat Komitmen", 1, "org", 9_000_000, 9_000_000],
    ]);
    expect(t).toBe(15_000_000);
  });

  it("pekerjaan yang namanya menyerupai jabatan TIDAK menghentikan apa pun", async () => {
    // Penanda dicocokkan UTUH pada isi sel. "Pekerjaan ruang direktur" adalah
    // pekerjaan, dan berhenti di situ akan memotong sisa berkas orang.
    const t = await total([
      ["3", "Pekerjaan Ruang Direktur", 2, "unit", 1_000_000, 2_000_000],
      ["", "Diperiksa Oleh :"],
      ["", "Site Manager", null, null, null, "NIP 199106202015031001"],
    ]);
    expect(t).toBe(17_000_000);
  });
});

describe("penghenti hanya berlaku sesudah ada item", () => {
  it("'Mengetahui' di KOP atas tabel tidak membuat berkas berakhir nol baris", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("RAB");
    ws.addRow(["Mengetahui"]);
    ws.addRow(["Pejabat Pembuat Komitmen"]);
    ws.addRow(["NO", "URAIAN PEKERJAAN", "VOLUME", "SATUAN", "HARGA SATUAN (Rp)", "JUMLAH HARGA (Rp)"]);
    ws.addRow(["I", "PEKERJAAN PERSIAPAN", null, null, null, null]);
    ws.addRow(["1", "Galian Tanah", 10, "m3", 1_000_000, 10_000_000]);
    const { parsed } = await parseHpsWorkbook(wb);
    expect(parsed.total).toBe(10_000_000);
  });
});
