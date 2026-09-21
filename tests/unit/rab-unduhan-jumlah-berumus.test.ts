/*
 * KOLOM JUMLAH DI UNDUHAN RAB = RUMUS, BUKAN ANGKA MATI.
 *
 * **Perintah user 2026-09-21**, sambil melampirkan berkas unduhannya sendiri:
 *
 *   *"download RAB, kenapa kolom jumlah kamu hardcode? padahal kan jelas kolom
 *   jumlah harusnya perkalian harga satuan dan volume. ini contohnya!"*
 *
 * dan, ketika saya mengangkat DECISIONS 212 (pembulatan AHSP) sebagai keberatan:
 *
 *   *"kenapa ribet sekali sih, kenapa bahas ahsp. sedangkan ini adalah cuma
 *   download RAB aktif darimu. aku gak tau gimana caranya, yang pasti kan konyol
 *   kalau misal sedang cek2 lalu jumlahnya ternyata hardcode"*
 *
 * Benar, dan ini MEMBALIK DECISIONS 212 dengan sengaja. Berkas ini dipakai orang
 * untuk MEMERIKSA: yang diperiksa pertama adalah apakah Jumlah memang volume ×
 * harga satuan. Kolom yang isinya angka mati tidak bisa diperiksa sama sekali —
 * ia cuma menyuruh percaya.
 *
 * Yang tetap dijaga: selisih rekalkulasi tidak boleh HILANG diam-diam. Harga
 * satuan disimpan `Decimal(15,2)` sedangkan AHSP sumbernya lebih panjang, jadi
 * pada sebagian baris `ROUND(vol × harga)` memang tidak mendarat persis di angka
 * tersimpan. Kalau itu terjadi, berkasnya WAJIB mengatakannya — bukan menyimpan
 * angka mati supaya selisihnya tak terlihat (CALCULATION_INTEGRITY_PROTOCOL;
 * DECISIONS 203: penyesuaian harus dikatakan).
 */
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

const { buildRabXlsx } = await import("@/lib/export/rab-xlsx");
import type { RabExportNode } from "@/lib/export/rab-xlsx";

function rumus(cell: ExcelJS.Cell): { formula?: string; result?: number } {
  const v = cell.value;
  if (v && typeof v === "object" && "formula" in v) {
    return { formula: (v as { formula: string }).formula, result: (v as { result?: number }).result };
  }
  return {};
}

function barisDengan(ws: ExcelJS.Worksheet, col: number, text: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = ws.getCell(r, col).value;
    if (typeof v === "string" && v.includes(text)) return r;
  }
  throw new Error(`Teks "${text}" tidak ditemukan di kolom ${col}`);
}

function cariBaris(ws: ExcelJS.Worksheet, text: string): number | null {
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= 6; c++) {
      const v = ws.getCell(r, c).value;
      if (typeof v === "string" && v.includes(text)) return r;
    }
  }
  return null;
}

async function bangun(nodes: RabExportNode[], totalValue: bigint) {
  const buffer = await buildRabXlsx({
    locationName: "Lokasi Uji",
    packageName: "Paket Uji",
    contractNumber: null,
    vendorName: null,
    ppnPercent: 11,
    revisionNo: 1,
    totalValue,
    nodes,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

const BULAT: RabExportNode[] = [
  { id: "k1", parentId: null, kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", unit: null, volume: null, unitPrice: null, amount: 25_000_000n },
  { id: "i1", parentId: "k1", kind: "item", code: "1", name: "Galian tanah", unit: "m3", volume: 50, unitPrice: 500_000, amount: 25_000_000n },
];

describe("Detail RAB – Jumlah item berupa rumus", () => {
  it("sel Jumlah item = ROUND(volume × harga satuan, 0), menunjuk barisnya sendiri", async () => {
    const wb = await bangun(BULAT, 25_000_000n);
    const det = wb.getWorksheet("Detail RAB")!;
    const r = barisDengan(det, 2, "Galian tanah");
    expect(rumus(det.getCell(r, 6)).formula).toBe(`ROUND(C${r}*E${r},0)`);
  });

  it("cache hasilnya tetap angka tersimpan – layar dan berkas menyebut angka yang sama sebelum dibuka", async () => {
    const wb = await bangun(BULAT, 25_000_000n);
    const det = wb.getWorksheet("Detail RAB")!;
    const r = barisDengan(det, 2, "Galian tanah");
    expect(rumus(det.getCell(r, 6)).result).toBe(25_000_000);
  });

  it("induk tetap menjumlahkan sel anak, bukan mengulang perkalian", async () => {
    const wb = await bangun(BULAT, 25_000_000n);
    const det = wb.getWorksheet("Detail RAB")!;
    const rItem = barisDengan(det, 2, "Galian tanah");
    const kat = rumus(det.getCell(barisDengan(det, 2, "PEKERJAAN PERSIAPAN"), 6));
    expect(kat.formula).toBe(`F${rItem}`);
  });

  it("item TANPA volume/harga satuan tetap angka mati – tidak ada yang bisa dikalikan", async () => {
    // 348 item pada data nyata memang begini (semuanya bernilai 0). Rumus
    // ROUND(0*0,0) kebetulan benar di situ, tetapi menuliskannya berarti
    // mengarang perkalian yang tidak ada dasarnya di dokumen.
    const nodes: RabExportNode[] = [
      { id: "k1", parentId: null, kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", unit: null, volume: null, unitPrice: null, amount: 0n },
      { id: "i1", parentId: "k1", kind: "item", code: "1", name: "Lump sum tanpa rincian", unit: null, volume: null, unitPrice: null, amount: 0n },
    ];
    const det = (await bangun(nodes, 0n)).getWorksheet("Detail RAB")!;
    const r = barisDengan(det, 2, "Lump sum tanpa rincian");
    expect(rumus(det.getCell(r, 6)).formula).toBeUndefined();
    expect(det.getCell(r, 6).value).toBe(0);
  });
});

/**
 * Kasus Wonorejo (unduhan 2 Agustus 2026) — alasan DECISIONS 212 dulu ditulis.
 * 4852,122 × 8465,19 = 41.074.134,6 → ROUND = 41.074.135; dokumen menulis
 * 41.074.131. Selisih Rp4 pada satu baris.
 */
const MIRING: RabExportNode[] = [
  { id: "k1", parentId: null, kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", unit: null, volume: null, unitPrice: null, amount: 41_074_131n },
  { id: "i1", parentId: "k1", kind: "item", code: "1", name: "Land clearing", unit: "m2", volume: 4852.122, unitPrice: 8465.19, amount: 41_074_131n },
];

describe("selisih rekalkulasi DIKATAKAN, tidak disembunyikan", () => {
  it("baris yang meleset tetap berumus – periksanya jalan, angkanya tidak dikarang", async () => {
    const det = (await bangun(MIRING, 41_074_131n)).getWorksheet("Detail RAB")!;
    const r = barisDengan(det, 2, "Land clearing");
    expect(rumus(det.getCell(r, 6)).formula).toBe(`ROUND(C${r}*E${r},0)`);
    expect(rumus(det.getCell(r, 6)).result).toBe(41_074_131);
    expect(Math.round(4852.122 * 8465.19)).toBe(41_074_135); // selisihnya nyata
  });

  it("Resume memuat catatan yang menyebut selisihnya beserta sebabnya", async () => {
    const res = (await bangun(MIRING, 41_074_131n)).getWorksheet("Resume")!;
    const r = cariBaris(res, "Catatan:");
    expect(r).not.toBeNull();
    // Spasi setelah "Rp" dari Intl adalah NBSP, jadi yang dicocokkan angkanya.
    const teks = String(res.getCell(r!, 1).value ?? "");
    expect(teks).toMatch(/harga satuan/i);
    expect(teks).toMatch(/\b4\b/); // selisihnya disebut
    expect(teks).toMatch(/41\.074\.131/); // beserta nilai tersimpannya
  });

  it("tanpa selisih, tidak ada catatan sama sekali – jangan menakuti tanpa sebab", async () => {
    const res = (await bangun(BULAT, 25_000_000n)).getWorksheet("Resume")!;
    expect(cariBaris(res, "harga satuan")).toBeNull();
  });
});
