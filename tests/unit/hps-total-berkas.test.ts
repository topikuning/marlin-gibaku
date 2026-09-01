// Σ ITEM YANG TERBACA vs TOTAL YANG DITULIS BERKAS ITU SENDIRI.
//
// Sampai audit 2026-09-01 tidak ada satu pun pemeriksaan yang mengadu hasil
// bacaan parser dengan angka yang tertulis di berkasnya sendiri. Akibatnya
// berkas yang sebagian barisnya tidak terbaca menghasilkan pratinjau yang
// mengaku "Nilai turun Rp 569 juta" tanpa cara apa pun bagi pemakainya untuk
// tahu apakah penurunan itu nyata atau bacaan yang bolong.
//
// Laporan user 2026-09-02 menanyakan persis itu: "maksud -569.812.788 itu apa?
// sedangkan kalau dihitung-hitung selisih cuma 100jtan."
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseHpsWorkbook } from "@/lib/rab/hps-parser";

type Baris = [string, string, number | null, string | null, number | null, number | null];

async function berkas(items: Baris[], totalDitulis: number | null): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RAB");
  ws.addRow(["NAMA PROYEK", "", ": Uji Total"]);
  ws.addRow([]);
  ws.addRow(["NO", "URAIAN PEKERJAAN", "VOLUME", "SATUAN", "HARGA SATUAN (Rp)", "JUMLAH HARGA (Rp)"]);
  ws.addRow(["I", "PEKERJAAN PERSIAPAN", null, null, null, null]);
  for (const b of items) ws.addRow(b);
  if (totalDitulis != null) ws.addRow(["", "JUMLAH", null, null, null, totalDitulis]);
  return wb;
}

const ITEM: Baris[] = [
  ["1", "Galian Tanah", 10, "m3", 1_000_000, 10_000_000],
  ["2", "Urugan Pasir", 5, "m3", 1_000_000, 5_000_000],
  ["3", "Pasangan Batu", 20, "m3", 1_000_000, 20_000_000],
];
const SIGMA = 35_000_000;

const peringatanSelisih = (w: string[]) => w.filter((x) => x.includes("total yang DITULIS berkas"));

async function warn(items: Baris[], totalDitulis: number | null): Promise<string[]> {
  const { warnings } = await parseHpsWorkbook(await berkas(items, totalDitulis));
  return peringatanSelisih(warnings);
}

describe("selisih terhadap total berkas dikatakan, bukan didiamkan", () => {
  it("berkas menulis total LEBIH BESAR dari yang terbaca: berbunyi", async () => {
    // Berkas bilang 40 juta, parser cuma menemukan 35 juta – 5 juta tidak
    // terbaca, dan tanpa peringatan ini selisih itu masuk nilai kontrak.
    const w = await warn(ITEM, 40_000_000);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("tidak terbaca parser");
  });

  it("berkas menulis total LEBIH KECIL: berbunyi dengan sebab yang berbeda", async () => {
    const w = await warn(ITEM, 30_000_000);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("terhitung dua kali");
  });

  it("cocok: TIDAK berbunyi", async () => {
    expect(await warn(ITEM, SIGMA)).toEqual([]);
  });

  it("beda pembulatan di bawah 0,5%: TIDAK berbunyi", async () => {
    expect(await warn(ITEM, SIGMA + 1_000)).toEqual([]);
  });

  it("total berkas yang sudah termasuk PPN 11%: TIDAK dituduh selisih", async () => {
    // Sebagian berkas menulis baris "JUMLAH" yang sudah ber-PPN walau namanya
    // polos. Itu bukan bacaan yang bolong.
    expect(await warn(ITEM, Math.round(SIGMA * 1.11))).toEqual([]);
  });

  it("berkas tanpa baris total sama sekali: TIDAK berbunyi", async () => {
    expect(await warn(ITEM, null)).toEqual([]);
  });

  it("SUBTOTAL per kategori tidak diperlakukan sebagai total akhir", async () => {
    // Berkas RAB lazim memuat baris "JUMLAH" per kategori tanpa satu total
    // akhir. Mengambil yang terbesar begitu saja membuat peringatan menyala
    // pada berkas yang sempurna - persis kelas kesalahan yang sedang
    // diperbaiki.
    const p = await parseHpsWorkbook(await berkas(ITEM, 20_000_000));
    expect(peringatanSelisih(p.warnings)).toEqual([]);
  });

  it("PPN 12% juga tidak dituduh selisih", async () => {
    expect(await warn(ITEM, Math.round(SIGMA * 1.12))).toEqual([]);
  });
});
