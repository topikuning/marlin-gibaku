// MEMBACA NAMA SHEET TIDAK BOLEH MEMUAT ISINYA.
//
// Laporan user 2026-08-07 (kontainer 512 MB / 0,5 CPU):
//   FATAL ERROR: Reached heap limit — Allocation failed
// saat memuat berkas MC-0 Sugihwaras.
//
// Sebabnya satu baris: impor mode draft memuat SELURUH workbook cuma untuk
// mengintip satu sel penanda template adendum. Diukur pada berkas KKP 3 MB /
// 45 sheet: intip itu +180 MB heap dan 25 detik, sementara parse yang
// sesungguhnya (sesudah penipisan) hanya +69 MB dan 0,5 detik.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { namaSheetXlsx, slimRabWorkbook } from "@/lib/rab/xlsx-slim";
import { parseHpsBuffer } from "@/lib/rab/hps-parser";

async function xlsxDenganSheet(...nama: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const n of nama) wb.addWorksheet(n).getRow(1).values = ["x"];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("namaSheetXlsx", () => {
  it("mengembalikan seluruh nama sheet sesuai urutannya", async () => {
    expect((await namaSheetXlsx(await xlsxDenganSheet("RAB", "Resume", "CCO-01"))).map((s) => s.nama)).toEqual([
      "RAB",
      "Resume",
      "CCO-01",
    ]);
  });

  it("nama ber-karakter khusus tidak rusak (di-unescape dari XML)", async () => {
    expect((await namaSheetXlsx(await xlsxDenganSheet("Vol A & B"))).map((s) => s.nama)).toEqual(["Vol A & B"]);
  });

  it("berkas rusak → daftar kosong, BUKAN melempar", async () => {
    // Pemanggilnya memperlakukan kosong sebagai "bukan template", lalu jalur
    // parse biasa yang melaporkan galatnya dengan pesan yang sudah dikenal.
    expect(await namaSheetXlsx(Buffer.from("ini bukan xlsx"))).toEqual([]);
  });
});

describe("sheet tersembunyi tidak dibaca", () => {
  it("ditandai tersembunyi, dan yang dipakai justru sheet terlihat", async () => {
    // Permintaan user 2026-08-07: *"cuma perlu baca sheet tertentu saja, dan
    // yang tidak dihide."* Sheet yang di-hide di berkas KKP itu sisa kerja,
    // arsip, atau lembar bantu — bukan yang sedang dipakai tim.
    const wb = new ExcelJS.Workbook();
    const lama = wb.addWorksheet("RAB"); // namanya paling "benar", tapi DI-HIDE
    lama.state = "hidden";
    lama.getRow(1).values = ["NO", "URAIAN", "VOLUME", "SATUAN", "HARGA SATUAN", "JUMLAH HARGA"];
    lama.getRow(2).values = ["I", "PEKERJAAN LAMA"];
    lama.getRow(3).values = ["1", "Item lama", 9, "m³", 1000, 9000];

    const baru = wb.addWorksheet("Lampiran Revisi"); // namanya asing, tapi TERLIHAT
    baru.getRow(1).values = ["NO", "URAIAN", "VOLUME", "SATUAN", "HARGA SATUAN", "JUMLAH HARGA"];
    baru.getRow(2).values = ["I", "PEKERJAAN PERSIAPAN"];
    baru.getRow(3).values = ["1", "Galian tanah", 10, "m³", 50_000, 500_000];
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const info = await namaSheetXlsx(buf);
    expect(info.find((s) => s.nama === "RAB")!.tersembunyi).toBe(true);
    expect(info.find((s) => s.nama === "Lampiran Revisi")!.tersembunyi).toBe(false);

    // Sheet bernama "RAB" DILEWATI karena di-hide; sheet terlihat yang dipakai,
    // walau namanya tidak dikenal — itu inti "luwes" tanpa jadi menebak.
    const { parsed } = await parseHpsBuffer(buf);
    expect(parsed.categories[0].name).toBe("PEKERJAAN PERSIAPAN");
    expect(parsed.categories[0].direct_items[0].name).toBe("Galian tanah");
  });

  it("hanya SATU sheet yang dimuat, bukan seluruh workbook", async () => {
    // Inti hemat memorinya: berkas KKP bisa 45 sheet; memuat semuanya berharga
    // 180 MB heap dan itulah yang mematikan proses di kontainer 512 MB.
    const wb = new ExcelJS.Workbook();
    for (let i = 0; i < 6; i++) wb.addWorksheet(`Vol ${i}`).getRow(1).values = ["x"];
    const ws = wb.addWorksheet("RAB");
    ws.getRow(1).values = ["NO", "URAIAN", "VOLUME", "SATUAN", "HARGA SATUAN", "JUMLAH HARGA"];
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const slim = await slimRabWorkbook(buf, "RAB");
    const hasil = new ExcelJS.Workbook();
    await hasil.xlsx.load(slim as unknown as ArrayBuffer);
    expect(hasil.worksheets.map((w) => w.name)).toEqual(["RAB"]);
  });
});

describe("jalur impor draft tidak boleh memuat workbook untuk mengintip", () => {
  it("nama sheet diperiksa SEBELUM xlsx.load", () => {
    const src = readFileSync("src/app/(app)/lokasi/[slug]/rab/import/actions.ts", "utf8");
    const iCek = src.indexOf("namaSheetXlsx(buffer)");
    const iLoad = src.indexOf("probe.xlsx.load");
    expect(iCek).toBeGreaterThan(-1);
    expect(iLoad).toBeGreaterThan(-1);
    expect(iCek).toBeLessThan(iLoad);
    // Dan load-nya HARUS berada di dalam penjagaan itu, bukan sekadar sesudahnya.
    expect(src.slice(iCek, iLoad)).toMatch(/if \(mungkinTemplate\)/);
  });
});
