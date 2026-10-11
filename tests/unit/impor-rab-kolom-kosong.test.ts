/*
 * SHEET TERBACA TAPI KOLOM HARGANYA KOSONG = MARLIN TIDAK PAHAM → TANYA.
 *
 * Laporan user 2026-10-11 (berkas "RAB Nego.xlsx", impor RAB pertama):
 * layar berhenti di *"Tidak ada baris RAB yang terbaca. Periksa sheet 'RAB'
 * di berkas Anda."* – tanpa pilihan sheet/kolom. Teguran user: *"kenapa kamu
 * tidak terapkan pemetaan pembacaan manual yang sudah ada jika sistem tidak
 * paham!"* (DECISIONS 624).
 *
 * Sebabnya: pembaca menemukan baris pekerjaan (nomor + uraian), tapi kolom
 * harga satuan dan jumlah yang ia kenali kosong semua – kolomnya salah tebak.
 * Pembaca menganggap sheet itu "berisi" karena ada barisnya; baru sesudahnya
 * baris tanpa nilai dibuang, tersisa nol, dan layar buntu. "Ada baris tapi
 * tidak satu pun bernilai" berarti pembacaan TIDAK dipahami – itu harus
 * menjadi pertanyaan, bukan galat.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { ImporPerluJawaban, parseHpsBuffer } from "@/lib/rab/hps-parser";

/** Sheet RAB yang angkanya ada di kolom H/I (judul tak dikenali), sementara kolom berjudul HARGA/JUMLAH (E/F) kosong. */
async function berkasKolomGeser(namaSheet = "RAB"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(namaSheet);
  ws.addRow(["RENCANA ANGGARAN BIAYA"]);
  ws.addRow([]);
  ws.addRow(["NO", "URAIAN PEKERJAAN", "VOLUME", "SATUAN", "HARGA SATUAN (Rp)", "JUMLAH HARGA (Rp)", "", "KOLOM A", "KOLOM B"]);
  ws.addRow(["I", "PEKERJAAN PERSIAPAN"]);
  ws.addRow([1, "Pembersihan lahan", 100, "m2", null, null, "", 25_000, 2_500_000]);
  ws.addRow([2, "Pengukuran dan bouwplank", 50, "m1", null, null, "", 40_000, 2_000_000]);
  ws.addRow(["II", "PEKERJAAN TANAH"]);
  ws.addRow([1, "Galian tanah", 30, "m3", null, null, "", 90_000, 2_700_000]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("baris pekerjaan ada, tapi tidak satu pun bernilai", () => {
  it("MARLIN bertanya sheet & kolom, tidak berhenti dengan galat", async () => {
    let tanya: ImporPerluJawaban | null = null;
    try {
      await parseHpsBuffer(await berkasKolomGeser());
    } catch (e) {
      if (e instanceof ImporPerluJawaban) tanya = e;
      else throw e;
    }
    expect(tanya, "harus jadi pertanyaan pemetaan, bukan hasil kosong").not.toBeNull();
    expect(tanya!.sebab).toMatch(/harga satuan/i);
    expect(tanya!.pilihan.sheets).toContain("RAB");
    // Kolom berkas ditawarkan supaya user bisa memilih H/I.
    expect(tanya!.pilihan.kolom.map((k) => k.huruf)).toEqual(expect.arrayContaining(["H", "I"]));
  });

  it("sesudah kolomnya dipilih, berkas terbaca dengan angka dari kolom pilihan", async () => {
    const r = await parseHpsBuffer(await berkasKolomGeser(), {
      sheet: "RAB",
      kolom: { vol: 3, unit: 4, price: 8, amount: 9 },
    });
    const items = r.parsed.categories.flatMap((c) => c.direct_items);
    expect(items.map((i) => i.total_price)).toEqual([2_500_000, 2_000_000, 2_700_000]);
  });

  it("pilihan kolom yang tetap kosong → ditanya lagi, bukan diterima kosong", async () => {
    await expect(
      parseHpsBuffer(await berkasKolomGeser(), { sheet: "RAB", kolom: { vol: 3, unit: 4, price: 5, amount: 6 } }),
    ).rejects.toBeInstanceOf(ImporPerluJawaban);
  });
});
