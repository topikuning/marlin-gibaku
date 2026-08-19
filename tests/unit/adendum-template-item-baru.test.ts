// MENAMBAH ITEM BARU DI TEMPLATE ADENDUM HARUS BENAR-BENAR BISA DILAKUKAN.
//
// Laporan user 2026-08-08: *"template adendum, tambah item, misal itu di baris
// 479, insert berhasil, tapi ketika input pekerjaan jadi tidak bisa."* — Excel
// menjawab "the cell you're trying to change is on a protected sheet".
//
// Berkasnya bertentangan dengan dirinya sendiri: baris petunjuknya menyuruh
// "sisipkan baris, isi Kode/Uraian/Satuan/Harga Satuan", padahal keempat kolom
// itu terkunci. Menyisipkan baris memang berhasil (proteksi mengizinkan
// insertRows), tapi baris sisipan MEWARISI FORMAT baris di atasnya — termasuk
// status terkuncinya. Jadi jalur yang diperintahkan berkas itu buntu di
// langkah kedua.
//
// Karena baris sisipan mewarisi tetangganya, "boleh diketik" tidak boleh
// bergantung pada baris — kalau bergantung, hasilnya berubah-ubah menurut di
// mana orang kebetulan menyisipkan, dan itu tidak bisa dijelaskan kepada siapa
// pun. Aturannya sekarang per KOLOM, seragam untuk seluruh tabel. Uji ini
// mengunci aturan itu di kedua arah: yang harus terbuka DAN yang harus tetap
// terkunci.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { ADENDUM_HEADER_ROW, ADENDUM_TEMPLATE_SHEET } from "@/lib/export/adendum-template-xlsx";

const { buildAdendumTemplateXlsx } = await import("@/lib/export/adendum-template-xlsx");
const { parseAdendumTemplate, AdendumTemplateError } = await import(
  "@/lib/rab/adendum-template-parse"
);

type Node = Parameters<typeof buildAdendumTemplateXlsx>[0]["nodes"][number];

const NODES: Node[] = [
  {
    id: "k1",
    parentId: null,
    kind: "kategori",
    code: "I",
    name: "PEKERJAAN PERSIAPAN",
    unit: null,
    volume: null,
    unitPrice: null,
    amount: 5_000_000n,
    lineageKey: "I",
  },
  {
    id: "i1",
    parentId: "k1",
    kind: "item",
    code: "1",
    name: "Galian tanah",
    unit: "m3",
    volume: 50,
    unitPrice: 100_000,
    amount: 5_000_000n,
    lineageKey: "I#1",
  },
];

const INPUT = {
  locationName: "Batah Timur",
  packageName: "Paket uji",
  contractNumber: null,
  vendorName: null,
  revisionNo: 1,
  totalValue: 5_000_000n,
  nodes: NODES,
};

async function buku(input = INPUT) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildAdendumTemplateXlsx(input)) as unknown as ArrayBuffer);
  return wb;
}
async function lembar(input = INPUT) {
  return (await buku(input)).getWorksheet(ADENDUM_TEMPLATE_SHEET)!;
}
async function cariBaris(ws: ExcelJS.Worksheet, nama: string): Promise<number> {
  let hasil = -1;
  ws.eachRow((row, r) => {
    if (row.getCell(2).value === nama) hasil = r;
  });
  expect(hasil, `baris "${nama}"`).toBeGreaterThan(0);
  return hasil;
}

/** Kolom yang WAJIB bisa diketik — persis yang dibutuhkan sebuah item baru. */
const TERBUKA: [number, string][] = [
  [1, "Kode"],
  [2, "Uraian Pekerjaan"],
  [4, "Sat"],
  [5, "Harga Satuan"],
  [7, "VOLUME ADENDUM"],
  [10, "Keterangan"],
];
/** Kolom yang WAJIB tetap terkunci: rekaman kontrak, rumus, identitas, fakta. */
const TERKUNCI: [number, string][] = [
  [3, "Volume Kontrak"],
  [6, "Jumlah Kontrak"],
  [8, "Jumlah Adendum (rumus)"],
  [9, "Selisih (rumus)"],
  [11, "lineageKey"],
  [12, "Realisasi Tercatat"],
];

describe("baris sisipan harus bisa diketik", () => {
  it("kolom isian item TERBUKA di baris item – sumber warisan baris sisipan", async () => {
    const ws = await lembar();
    const r = await cariBaris(ws, "Galian tanah");
    for (const [kolom, nama] of TERBUKA) {
      expect(ws.getCell(r, kolom).protection?.locked, `kolom ${nama} di baris item`).toBe(false);
    }
  });

  it("kolom yang sama TERBUKA di baris kategori – menyisipkan tepat di bawah judul kategori sama sahnya", async () => {
    // Kalau hanya baris item yang dibuka, menyisipkan baris persis di bawah
    // judul kategori mewarisi kunci kategori dan buntu lagi — bug yang sama
    // dengan wajah berbeda.
    const ws = await lembar();
    const r = await cariBaris(ws, "PEKERJAAN PERSIAPAN");
    for (const [kolom, nama] of TERBUKA) {
      expect(ws.getCell(r, kolom).protection?.locked, `kolom ${nama} di baris kategori`).toBe(false);
    }
  });

  it("rekaman kontrak, rumus, identitas, dan realisasi TETAP terkunci", async () => {
    // Diperiksa sebagai "TIDAK dibuka", bukan "locked === true". Terkunci adalah
    // bawaan OOXML, jadi penulis berkas membuangnya saat menulis dan ia terbaca
    // kembali sebagai undefined. Di Excel keduanya berarti sama: terkunci.
    // Menuntut `true` berarti menguji cara ExcelJS menyimpan, bukan cara Excel
    // memperlakukan selnya.
    const ws = await lembar();
    const r = await cariBaris(ws, "Galian tanah");
    for (const [kolom, nama] of TERKUNCI) {
      expect(ws.getCell(r, kolom).protection?.locked, `kolom ${nama}`).not.toBe(false);
    }
  });

  it("sheet tetap diproteksi dan tetap mengizinkan penyisipan baris", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await buildAdendumTemplateXlsx(INPUT));
    const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(xml).toContain("<sheetProtection");
    expect(xml).toMatch(/insertRows="0"/); // 0 = TIDAK dilarang (atribut = "larangan")
  });

  it("petunjuk di berkas menyebut jalur yang benar-benar bisa ditempuh", async () => {
    const ws = await lembar();
    const teks = String(ws.getCell(6, 1).value ?? "");
    expect(teks).toMatch(/SISIPKAN BARIS KOSONG/i);
    // Menyalin baris lama membawa serta identitasnya — harus diperingatkan di
    // berkasnya, bukan hanya ditolak belakangan saat diunggah.
    expect(teks).toMatch(/jangan menyalin/i);
  });
});

// ─────────────────────────────────────────────────────────────
// Sisi impor: dua cara kehilangan pekerjaan orang tanpa sepatah kata
// ─────────────────────────────────────────────────────────────

/** Bangun template, lalu suntik baris seperti yang dilakukan user di Excel. */
async function bukuDenganBarisTambahan(
  isi: (ws: ExcelJS.Worksheet, barisBaru: number) => void,
): Promise<ExcelJS.Workbook> {
  const wb = await buku();
  const ws = wb.getWorksheet(ADENDUM_TEMPLATE_SHEET)!;
  const r = (await cariBaris(ws, "Galian tanah")) + 1;
  ws.spliceRows(r, 0, []); // sisipkan satu baris kosong, seperti Insert di Excel
  isi(ws, r);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
  return wb2;
}

describe("item baru yang disisipkan terbaca kembali", () => {
  it("baris kosong yang diisi lengkap menjadi item baru di kategori itu", async () => {
    const wb = await bukuDenganBarisTambahan((ws, r) => {
      ws.getCell(r, 1).value = "1a";
      ws.getCell(r, 2).value = "Galian tanah keras";
      ws.getCell(r, 4).value = "m3";
      ws.getCell(r, 5).value = 150_000;
      ws.getCell(r, 7).value = 10;
    });
    const hasil = parseAdendumTemplate(wb);
    expect(hasil.itemBaru.map((i) => i.name)).toContain("Galian tanah keras");
    const baru = hasil.nodes.find((n) => n.name === "Galian tanah keras")!;
    expect(baru.amount).toBe(1_500_000n);
    expect(baru.parentLineageKey).toBe("I");
    // Identitasnya bertanda "+" supaya tidak mungkin bentrok dengan item lama.
    expect(baru.lineageKey).toContain("#+");
  });

  it("baris yang cuma diketik uraiannya DITOLAK dengan menyebut barisnya, bukan dibuang diam-diam", async () => {
    // Bentuk paling wajar dari pekerjaan yang tertunda: nama sudah diketik,
    // angkanya belum. Melewatinya membuat item itu lenyap dari adendum dan baru
    // ketahuan saat nilai kontraknya tidak cocok.
    const wb = await bukuDenganBarisTambahan((ws, r) => {
      ws.getCell(r, 2).value = "Galian tanah keras";
    });
    expect(() => parseAdendumTemplate(wb)).toThrow(AdendumTemplateError);
    expect(() => parseAdendumTemplate(wb)).toThrow(/Galian tanah keras/);
  });

  it("baris lama yang DISALIN ditolak – identitas ganda tidak boleh menimpa diam-diam", async () => {
    // Cara tercepat membuat item baru adalah menyalin baris lama supaya rumus
    // dan formatnya ikut. Salinannya membawa lineageKey di kolom tersembunyi,
    // jadi dua baris mengaku item kontrak yang sama.
    const wb = await bukuDenganBarisTambahan((ws, r) => {
      ws.getCell(r, 1).value = "1a";
      ws.getCell(r, 2).value = "Galian tanah keras";
      ws.getCell(r, 4).value = "m3";
      ws.getCell(r, 5).value = 150_000;
      ws.getCell(r, 7).value = 10;
      ws.getCell(r, 11).value = "I#1"; // ← ikut tersalin
    });
    expect(() => parseAdendumTemplate(wb)).toThrow(AdendumTemplateError);
    expect(() => parseAdendumTemplate(wb)).toThrow(/identitas item yang sama/i);
  });
});
