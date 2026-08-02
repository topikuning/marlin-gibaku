// TEMPLATE KERJA ADENDUM: ekspor → isi di Excel → impor balik (DECISIONS 216).
//
// Permintaan user 2026-08-02: "aku juga butuh template adendum, kamu harusnya
// dari rab yang ada bisa export format untuk adendum", dengan dua pertanyaan
// yang menentukan desainnya: item baru ditaruh mana, dan apakah volume 0
// berarti item dihapus.
//
// Yang diuji di sini bukan "ada kolomnya", tapi empat keadaan yang merugikan
// orang kalau salah:
//   1. baris yang TIDAK disentuh harus keluar dengan Jumlah PERSIS angka
//      dokumen — bukan hasil kali ulang yang meleset (DECISIONS 212);
//   2. volume 0 BUKAN penghapusan;
//   3. HAPUS adalah satu-satunya cara mencabut item;
//   4. item baru menempel ke kategori tempat ia disisipkan, dengan lineageKey
//      yang tidak mungkin bentrok dengan item kontrak yang punya realisasi.
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

const { buildAdendumTemplateXlsx, ADENDUM_TEMPLATE_SHEET, ADENDUM_HEADER_ROW } = await import(
  "@/lib/export/adendum-template-xlsx"
);
const { parseAdendumTemplate, isAdendumTemplate, AdendumTemplateError } = await import(
  "@/lib/rab/adendum-template-parse"
);
type Node = import("@/lib/export/adendum-template-xlsx").AdendumTemplateNode;

/**
 * Meniru kondisi nyata RAB Wonorejo: harga satuan dokumen berdesimal sehingga
 * ROUND(vol×harga) TIDAK sama dengan Jumlah yang tertulis di kontrak.
 * 4852,122 × 8465,19 = 41.074.134,6 → hasil kali 41.074.135, dokumen 41.074.131.
 */
const NODES: Node[] = [
  { id: "k1", parentId: null, kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", unit: null, volume: null, unitPrice: null, amount: 41_074_131n, lineageKey: "I" },
  { id: "i1", parentId: "k1", kind: "item", code: "1", name: "Land clearing", unit: "m2", volume: 4852.122, unitPrice: 8465.19, amount: 41_074_131n, lineageKey: "I#1" },
  { id: "k2", parentId: null, kind: "kategori", code: "V", name: "PEKERJAAN SHELTER", unit: null, volume: null, unitPrice: null, amount: 30_000_000n, lineageKey: "V" },
  { id: "i2", parentId: "k2", kind: "item", code: "1", name: "Pembesian", unit: "kg", volume: 1000, unitPrice: 20_000, amount: 20_000_000n, lineageKey: "V#1" },
  { id: "i3", parentId: "k2", kind: "item", code: "2", name: "Beton K-250", unit: "m3", volume: 10, unitPrice: 1_000_000, amount: 10_000_000n, lineageKey: "V#2" },
];

async function terbitkan(): Promise<ExcelJS.Workbook> {
  const buf = await buildAdendumTemplateXlsx({
    locationName: "Wonorejo",
    packageName: "KNMP Situbondo",
    contractNumber: "B.17114",
    vendorName: "CV. Tosan",
    revisionNo: 1,
    totalValue: 71_074_131n,
    nodes: NODES,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/** Cari baris berdasarkan uraian di kolom B. */
function baris(ws: ExcelJS.Worksheet, uraian: string): number {
  for (let r = ADENDUM_HEADER_ROW + 1; r <= ws.rowCount; r++) {
    if (String(ws.getCell(r, 2).value ?? "").trim() === uraian) return r;
  }
  throw new Error(`Baris "${uraian}" tidak ada`);
}

describe("template terbitan MARLIN dikenali kembali", () => {
  it("penanda ada di sel header, jadi berkas lain tidak salah dibaca sebagai template", async () => {
    expect(isAdendumTemplate(await terbitkan())).toBe(true);
    const lain = new ExcelJS.Workbook();
    lain.addWorksheet("RAB").getCell("A1").value = "apa saja";
    expect(isAdendumTemplate(lain)).toBe(false);
  });

  it("volume adendum sudah terisi = volume kontrak, jadi yang tak disentuh aman", async () => {
    const ws = (await terbitkan()).getWorksheet(ADENDUM_TEMPLATE_SHEET)!;
    const r = baris(ws, "Land clearing");
    expect(ws.getCell(r, 3).value).toBe(4852.122); // volume kontrak
    expect(ws.getCell(r, 7).value).toBe(4852.122); // VOLUME ADENDUM (isian)
    expect(ws.getCell(r, 6).value).toBe(41_074_131); // Jumlah Kontrak = angka dokumen
  });
});

describe("KASUS INTI: baris yang tidak disentuh tidak boleh bergeser sepeser pun", () => {
  it("memakai Jumlah Kontrak apa adanya, bukan hasil kali ulang yang meleset Rp4", async () => {
    const wb = await terbitkan();
    const h = parseAdendumTemplate(wb);
    const item = h.nodes.find((n) => n.lineageKey === "I#1")!;
    expect(item.amount).toBe(41_074_131n);
    // Pembuktian selisihnya nyata — kalau parser menghitung ulang, jadi ini:
    expect(Math.round(4852.122 * 8465.19)).toBe(41_074_135);
    // Kategori = Σ anak, jadi ikut tepat.
    expect(h.nodes.find((n) => n.lineageKey === "I")!.amount).toBe(41_074_131n);
  });

  it("baris yang volumenya DIUBAH dihitung ulang dari harga kontrak", async () => {
    const wb = await terbitkan();
    const ws = wb.getWorksheet(ADENDUM_TEMPLATE_SHEET)!;
    ws.getCell(baris(ws, "Pembesian"), 7).value = 1200;
    const h = parseAdendumTemplate(wb);
    expect(h.nodes.find((n) => n.lineageKey === "V#1")!.amount).toBe(24_000_000n);
    expect(h.nodes.find((n) => n.lineageKey === "V")!.amount).toBe(34_000_000n);
  });
});

describe("KASUS INTI: volume 0 BUKAN penghapusan", () => {
  it("item tetap ada dengan nilai nol, dan keadaannya dilaporkan", async () => {
    const wb = await terbitkan();
    const ws = wb.getWorksheet(ADENDUM_TEMPLATE_SHEET)!;
    ws.getCell(baris(ws, "Beton K-250"), 7).value = 0;
    const h = parseAdendumTemplate(wb);

    const item = h.nodes.find((n) => n.lineageKey === "V#2");
    expect(item).toBeDefined(); // TIDAK hilang
    expect(item!.volume).toBe(0);
    expect(item!.amount).toBe(0n);
    expect(h.volumeNol.map((x) => x.name)).toEqual(["Beton K-250"]);
    expect(h.dihapus).toHaveLength(0);
  });

  it("HAPUS di kolom Keterangan barulah mencabut item", async () => {
    const wb = await terbitkan();
    const ws = wb.getWorksheet(ADENDUM_TEMPLATE_SHEET)!;
    ws.getCell(baris(ws, "Beton K-250"), 10).value = "hapus"; // huruf kecil pun diterima
    const h = parseAdendumTemplate(wb);

    expect(h.nodes.find((n) => n.lineageKey === "V#2")).toBeUndefined();
    expect(h.dihapus.map((x) => x.name)).toEqual(["Beton K-250"]);
    // Nilai kategori ikut turun sesuai item yang dicabut.
    expect(h.nodes.find((n) => n.lineageKey === "V")!.amount).toBe(20_000_000n);
  });
});

describe("KASUS INTI: item baru menempel ke kategori tempat ia disisipkan", () => {
  it("lineageKey-nya tidak mungkin bentrok dengan item kontrak yang punya realisasi", async () => {
    const wb = await terbitkan();
    const ws = wb.getWorksheet(ADENDUM_TEMPLATE_SHEET)!;
    // Sisipkan setelah baris terakhir kategori V (Beton K-250).
    const r = baris(ws, "Beton K-250") + 1;
    ws.insertRow(r, []);
    ws.getCell(r, 1).value = "3";
    ws.getCell(r, 2).value = "Bekisting tambahan";
    ws.getCell(r, 4).value = "m2";
    ws.getCell(r, 5).value = 150_000;
    ws.getCell(r, 7).value = 40;

    const h = parseAdendumTemplate(wb);
    const baru = h.nodes.find((n) => n.name === "Bekisting tambahan")!;
    expect(baru.parentLineageKey).toBe("V");
    expect(baru.lineageKey).toBe("V#+3");
    expect(baru.amount).toBe(6_000_000n);
    expect(h.itemBaru).toEqual([{ code: "3", name: "Bekisting tambahan", kategori: "PEKERJAAN SHELTER" }]);
    // Kategori V = 20jt + 10jt + 6jt.
    expect(h.nodes.find((n) => n.lineageKey === "V")!.amount).toBe(36_000_000n);
  });

  it("item baru tanpa harga DITOLAK dengan menyebut sebabnya, bukan diberi harga 0", async () => {
    const wb = await terbitkan();
    const ws = wb.getWorksheet(ADENDUM_TEMPLATE_SHEET)!;
    const r = baris(ws, "Beton K-250") + 1;
    ws.insertRow(r, []);
    ws.getCell(r, 2).value = "Tanpa harga";
    ws.getCell(r, 7).value = 5;

    expect(() => parseAdendumTemplate(wb)).toThrow(AdendumTemplateError);
    expect(() => parseAdendumTemplate(wb)).toThrow(/Harga Satuan/i);
  });
});
