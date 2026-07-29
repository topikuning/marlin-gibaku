import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

const { buildRabXlsx } = await import("@/lib/export/rab-xlsx");
import type { RabExportNode } from "@/lib/export/rab-xlsx";

/**
 * EKSPOR RAB 3 SHEET SALING TERTAUT FORMULA (permintaan user 29 Juli 2026):
 * Resume → Sub Resume → Detail RAB. Yang diuji: rumusnya BENAR-BENAR rumus
 * (bukan angka mati), referensi antar sheet menunjuk sel yang tepat, dan nilai
 * cache (result) identik dengan angka tersimpan DB.
 */

// Pohon uji: kategori I (item 2, salah satunya di bawah sub), kategori II (1 item).
const nodes: RabExportNode[] = [
  { id: "k1", parentId: null, kind: "kategori", code: "I", name: "PEKERJAAN GEDUNG", unit: null, volume: null, unitPrice: null, amount: 125_000_000n },
  { id: "s1", parentId: "k1", kind: "sub", code: "1", name: "Pekerjaan Tanah", unit: null, volume: null, unitPrice: null, amount: 25_000_000n },
  { id: "i1", parentId: "s1", kind: "item", code: "1.1", name: "Galian tanah", unit: "m3", volume: 50, unitPrice: 500_000, amount: 25_000_000n },
  { id: "i2", parentId: "k1", kind: "item", code: "2", name: "Pasangan batu", unit: "m3", volume: 100, unitPrice: 1_000_000, amount: 100_000_000n },
  { id: "k2", parentId: null, kind: "kategori", code: "II", name: "POS JAGA", unit: null, volume: null, unitPrice: null, amount: 8_000_000n },
  { id: "i3", parentId: "k2", kind: "item", code: "1", name: "Pondasi", unit: "m3", volume: 10, unitPrice: 800_000, amount: 8_000_000n },
];

async function bangun() {
  const buffer = await buildRabXlsx({
    locationName: "Lokasi Uji",
    packageName: "Paket Uji",
    contractNumber: "SPK-001",
    vendorName: "PT Uji",
    ppnPercent: 11,
    revisionNo: 3,
    totalValue: 133_000_000n,
    nodes,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

type SelRumus = { formula?: string; result?: number };

function rumus(cell: ExcelJS.Cell): SelRumus {
  const v = cell.value;
  if (v && typeof v === "object" && "formula" in v) {
    return { formula: (v as { formula: string }).formula, result: (v as { result?: number }).result };
  }
  return {};
}

/** Cari baris pertama pada kolom `col` yang teksnya mengandung `text`. */
function barisDengan(ws: ExcelJS.Worksheet, col: number, text: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = ws.getCell(r, col).value;
    if (typeof v === "string" && v.includes(text)) return r;
  }
  throw new Error(`Teks "${text}" tidak ditemukan di kolom ${col}`);
}

describe("ekspor RAB 3 sheet ber-formula", () => {
  it("urutan sheet: Resume, Sub Resume, Detail RAB", async () => {
    const wb = await bangun();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Resume", "Sub Resume", "Detail RAB"]);
  });

  it("Detail: Jumlah item = ROUND(volume×harga), induk = penjumlahan sel anak", async () => {
    const wb = await bangun();
    const det = wb.getWorksheet("Detail RAB")!;
    const rGalian = barisDengan(det, 2, "Galian tanah");
    const galian = rumus(det.getCell(rGalian, 6));
    expect(galian.formula).toBe(`ROUND(C${rGalian}*E${rGalian},0)`);
    expect(galian.result).toBe(25_000_000);

    const rKategori = barisDengan(det, 2, "PEKERJAAN GEDUNG");
    const kat = rumus(det.getCell(rKategori, 6));
    // kategori I = sub Tanah + item Pasangan batu (dua sel anak, bukan angka mati)
    expect(kat.formula).toMatch(/^F\d+\+F\d+$/);
    expect(kat.result).toBe(125_000_000);
  });

  it("Sub Resume menunjuk baris Detail; subtotal kategori = SUM blok", async () => {
    const wb = await bangun();
    const det = wb.getWorksheet("Detail RAB")!;
    const sub = wb.getWorksheet("Sub Resume")!;
    const rTanahDetail = barisDengan(det, 2, "Pekerjaan Tanah");
    const rTanahSub = barisDengan(sub, 2, "Pekerjaan Tanah");
    const link = rumus(sub.getCell(rTanahSub, 3));
    expect(link.formula).toBe(`'Detail RAB'!F${rTanahDetail}`);
    expect(link.result).toBe(25_000_000);

    const rSubtotal = barisDengan(sub, 2, "JUMLAH I — PEKERJAAN GEDUNG");
    const st = rumus(sub.getCell(rSubtotal, 3));
    expect(st.formula).toMatch(/^C\d+\+C\d+$/);
    expect(st.result).toBe(125_000_000);
  });

  it("Resume menunjuk subtotal Sub Resume; PPN & pembulatan berupa rumus", async () => {
    const wb = await bangun();
    const sub = wb.getWorksheet("Sub Resume")!;
    const res = wb.getWorksheet("Resume")!;
    const rSubtotalI = barisDengan(sub, 2, "JUMLAH I — PEKERJAAN GEDUNG");
    const rKatResume = barisDengan(res, 2, "I — PEKERJAAN GEDUNG");
    expect(rumus(res.getCell(rKatResume, 3)).formula).toBe(`'Sub Resume'!C${rSubtotalI}`);

    const rJumlah = barisDengan(res, 2, "JUMLAH");
    const jumlah = rumus(res.getCell(rJumlah, 3));
    expect(jumlah.formula).toMatch(/^C\d+\+C\d+$/); // dua kategori
    expect(jumlah.result).toBe(133_000_000);

    const rPpn = barisDengan(res, 2, "PPN 11%");
    const ppn = rumus(res.getCell(rPpn, 3));
    expect(ppn.formula).toBe(`ROUND(C${rJumlah}*11%,0)`);
    expect(ppn.result).toBe(14_630_000);

    const rTotal = barisDengan(res, 2, "JUMLAH TOTAL");
    expect(rumus(res.getCell(rTotal, 3)).result).toBe(147_630_000);
    const rBulat = barisDengan(res, 2, "DIBULATKAN");
    expect(rumus(res.getCell(rBulat, 3)).formula).toBe(`ROUNDDOWN(C${rTotal},-3)`);
  });
});
