// TEMPLATE ADENDUM — PENGAMAN DI LEVEL BERKAS untuk item yang sudah terprogres.
//
// Pertanyaan user 2026-08-03: *"bagaimana dengan item yang sudah terlanjur
// dilaporkan, dan terprogres? apakah tidak ada pengamannya di level file
// excel?"* — dan jawabannya waktu itu: tidak ada. Server menolak volume di
// bawah realisasi (`rab/adendum.ts`) dan menolak mencabut item ber-realisasi,
// tetapi baru SESUDAH berkas diunggah balik. Template ini diisi jauh dari
// aplikasi, kerap oleh orang tanpa akses MARLIN. DECISIONS 242.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { ADENDUM_HEADER_ROW, ADENDUM_TEMPLATE_SHEET } from "@/lib/export/adendum-template-xlsx";

const { buildAdendumTemplateXlsx } = await import("@/lib/export/adendum-template-xlsx");

type Node = Parameters<typeof buildAdendumTemplateXlsx>[0]["nodes"][number];

const kat: Node = {
  id: "k1",
  parentId: null,
  kind: "kategori",
  code: "I",
  name: "PEKERJAAN PERSIAPAN",
  unit: null,
  volume: null,
  unitPrice: null,
  amount: 5_000_000n,
  lineageKey: "K#1",
};
const item = (id: string, name: string, volume: number, lineageKey: string): Node => ({
  id,
  parentId: "k1",
  kind: "item",
  code: id,
  name,
  unit: "m3",
  volume,
  unitPrice: 100_000,
  amount: BigInt(volume * 100_000),
  lineageKey,
});

const NODES: Node[] = [kat, item("1", "Galian tanah", 50, "I#1"), item("2", "Urugan pasir", 30, "I#2")];

const INPUT = {
  locationName: "Batah Timur",
  packageName: "Paket uji",
  contractNumber: null,
  vendorName: null,
  revisionNo: 1,
  totalValue: 8_000_000n,
  nodes: NODES,
  // "Galian tanah" sudah dikerjakan 20 dari 50; "Urugan pasir" belum tersentuh.
  realisasiByLineage: new Map([["I#1", 20]]),
};

async function lembar(input = INPUT) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildAdendumTemplateXlsx(input)) as unknown as ArrayBuffer);
  return wb.getWorksheet(ADENDUM_TEMPLATE_SHEET)!;
}
async function xmlSheet(input = INPUT): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await buildAdendumTemplateXlsx(input));
  return zip.file("xl/worksheets/sheet1.xml")!.async("string");
}
/** Baris item berdasarkan uraian di kolom B. */
async function cariBaris(ws: ExcelJS.Worksheet, nama: string): Promise<number> {
  let hasil = -1;
  ws.eachRow((row, r) => {
    if (row.getCell(2).value === nama) hasil = r;
  });
  expect(hasil, `baris "${nama}"`).toBeGreaterThan(0);
  return hasil;
}

describe("kolom REALISASI TERCATAT", () => {
  it("ada di header dan berisi angka lapangan", async () => {
    const ws = await lembar();
    expect(ws.getCell(ADENDUM_HEADER_ROW, 12).value).toBe("Realisasi Tercatat");
    const r = await cariBaris(ws, "Galian tanah");
    expect(ws.getCell(r, 12).value).toBe(20);
  });

  it("item tanpa realisasi tetap menulis 0, bukan sel kosong", async () => {
    // Kosong terbaca "belum diketahui"; 0 menyatakan "memang belum dikerjakan".
    const ws = await lembar();
    const r = await cariBaris(ws, "Urugan pasir");
    expect(ws.getCell(r, 12).value).toBe(0);
  });

  it("kolom 1–11 TIDAK bergeser — template lama harus tetap terbaca parser", async () => {
    // Penanda template ada di kolom 11; menggesernya membuat berkas yang sudah
    // beredar gagal dikenali dan diam-diam jatuh ke parser HPS biasa.
    const ws = await lembar();
    const header = [1, 2, 3, 4, 5, 6, 7, 10].map((c) => String(ws.getCell(ADENDUM_HEADER_ROW, c).value));
    expect(header).toEqual([
      "Kode",
      "Uraian Pekerjaan",
      "Volume Kontrak",
      "Sat",
      "Harga Satuan (Rp)",
      "Jumlah Kontrak (Rp)",
      "VOLUME ADENDUM",
      "Keterangan (isi HAPUS untuk mencabut)",
    ]);
  });
});

describe("validasi sel VOLUME ADENDUM", () => {
  it("item ber-realisasi: entri di bawahnya ditolak, pesannya menyebut angkanya", async () => {
    const ws = await lembar();
    const r = await cariBaris(ws, "Galian tanah");
    const dv = ws.getCell(r, 7).dataValidation;
    expect(dv, "validasi harus terpasang").toBeDefined();
    expect(dv?.operator).toBe("greaterThanOrEqual");
    expect(String((dv as { error?: string }).error)).toContain("20");
    expect(String((dv as { error?: string }).error)).toContain("m3");
  });

  it("rujukannya menunjuk sel REALISASI baris yang sama", async () => {
    // Diperiksa dari XML mentah: pembaca ExcelJS memaksa formula validasi
    // bertipe "decimal" jadi angka sehingga `$L$10` terbaca NaN — padahal
    // berkasnya benar. Menguji lewat pembaca yang cacat akan mengunci uji ke
    // bug pustaka, bukan ke isi berkas yang dibuka Excel.
    const ws = await lembar();
    const r = await cariBaris(ws, "Galian tanah");
    const xml = await xmlSheet();
    expect(xml).toMatch(new RegExp(`sqref="G${r}"[^>]*><formula1>\\$L\\$${r}</formula1>`));
  });

  it("item TANPA realisasi tidak dipasangi validasi", async () => {
    // Pagar hanya di tempat yang memang berpagar; validasi di mana-mana membuat
    // orang terbiasa menembusnya.
    const ws = await lembar();
    const r = await cariBaris(ws, "Urugan pasir");
    expect(ws.getCell(r, 7).dataValidation).toBeUndefined();
  });
});

describe("sorotan merah — jaring terakhir", () => {
  it("volume di bawah realisasi disoroti", async () => {
    // Diperiksa dari XML: tipe ExcelJS tidak mengekspos `conditionalFormattings`,
    // dan XML adalah yang benar-benar dibuka Excel.
    const ws = await lembar();
    const r = await cariBaris(ws, "Galian tanah");
    const xml = await xmlSheet();
    expect(xml).toContain(`<conditionalFormatting sqref="G${r}">`);
    expect(xml).toContain(`$G$${r}&lt;$L$${r}`); // "<" ter-escape di XML
  });

  it("HAPUS atas item ber-realisasi disoroti", async () => {
    // Server melarangnya mutlak (item ber-realisasi tidak bisa dicabut), jadi
    // berkasnya harus mengatakan itu SEBELUM diunggah.
    const ws = await lembar();
    const r = await cariBaris(ws, "Galian tanah");
    const xml = await xmlSheet();
    expect(xml).toContain(`<conditionalFormatting sqref="J${r}">`);
    // Escaping tanda kutip di XML berbeda antar penulis; yang dikunci adalah
    // formulanya menguji kolom KETERANGAN baris ini terhadap kata HAPUS.
    expect(xml).toMatch(new RegExp(`<conditionalFormatting sqref="J${r}">.*?HAPUS`, "s"));
  });

  it("item tanpa realisasi tidak disoroti sama sekali", async () => {
    const ws = await lembar();
    const r = await cariBaris(ws, "Urugan pasir");
    const xml = await xmlSheet();
    expect(xml).not.toContain(`<conditionalFormatting sqref="G${r}">`);
    expect(xml).not.toContain(`<conditionalFormatting sqref="J${r}">`);
  });
});

describe("petunjuk pengisian ditulis di berkasnya", () => {
  it("menyebut aturan realisasi, bukan hanya HAPUS", async () => {
    // Berkas ini beredar lewat WhatsApp/email, jauh dari aplikasi.
    const ws = await lembar();
    const petunjuk = String(ws.getCell(7, 1).value);
    expect(petunjuk).toContain("REALISASI TERCATAT");
    expect(petunjuk).toContain("tidak boleh di bawahnya");
    expect(petunjuk).toContain("ber-realisasi tidak bisa di-HAPUS");
  });

  it("baris petunjuk tidak menabrak baris header", async () => {
    // ADENDUM_HEADER_ROW dipakai parser; menggesernya membuat template lama
    // gagal dikenali. Petunjuk WAJIB berhenti sebelum baris itu.
    const ws = await lembar();
    expect(ws.getCell(ADENDUM_HEADER_ROW, 1).value).toBe("Kode");
  });
});

describe("berkasnya harus SAH menurut OOXML, bukan hanya menurut ExcelJS", () => {
  it("errorStyle memakai nilai yang dikenal spesifikasi", async () => {
    /*
     * Ditemukan saat berkas nyata dibuka pembaca lain: `errorStyle="error"`
     * BUKAN nilai sah OOXML (hanya stop/warning/information). ExcelJS menerima
     * nilai apa pun dan menuliskannya apa adanya, jadi berkasnya lolos semua
     * uji berbasis ExcelJS tetapi DITOLAK openpyxl — dan Excel akan mengeluh
     * "unreadable content" lalu membuang validasinya diam-diam.
     *
     * Menguji lewat pustaka yang sama yang menulis berkasnya tidak pernah
     * menangkap cacat kelas ini.
     */
    const xml = await xmlSheet();
    const gaya = [...xml.matchAll(/errorStyle="([^"]+)"/g)].map((m) => m[1]);
    expect(gaya.length, "harus ada validasi terpasang").toBeGreaterThan(0);
    for (const g of gaya) expect(["stop", "warning", "information"]).toContain(g);
  });
});
