// TEMPLATE ADENDUM — DUA CACAT YANG BARU MELEDAK SESUDAH DRAFT LAMA DIHAPUS.
//
// Keduanya sunyi di pratinjau dan baru terlihat saat "Simpan ke draft adendum":
// `discardDraft` dijalankan lebih dulu, lalu pembuatan revisi gagal — draft
// adendum yang sedang dikerjakan orang sudah terlanjur hilang.
//
//  F-2 ANAK YATIM. Baris induk yang dibuang (HAPUS, volume negatif, atau baris
//      judul yang dihapus user) meninggalkan anak dengan `parentLineageKey`
//      menunjuk kunci yang tidak ada lagi. `hitung()` hanya berjalan dari akar,
//      jadi rupiah anak tidak pernah sampai ke kategori: totalnya menyusut tanpa
//      satu kalimat pun, lalu `createRevisionFromNodes` melempar "orphan node".
//
//  F-3 lineageKey KEMBAR. Dua item baru berkode sama di bawah induk yang sama
//      menghasilkan kunci identik; `@@unique([revisionId, lineageKey])` menolak
//      di tengah penyimpanan dan yang sampai ke user pesan mentah Prisma.
//
// Audit 2026-09-15.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { ADENDUM_TEMPLATE_SHEET } from "@/lib/export/adendum-template-xlsx";

const { buildAdendumTemplateXlsx } = await import("@/lib/export/adendum-template-xlsx");
const { parseAdendumTemplate, AdendumTemplateError } = await import("@/lib/rab/adendum-template-parse");

type Node = Parameters<typeof buildAdendumTemplateXlsx>[0]["nodes"][number];

/** Kategori → item → anak item (bentuk yang nyata di RAB KKP, DECISIONS 563). */
const NODES: Node[] = [
  { id: "k1", parentId: null, kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", unit: null, volume: null, unitPrice: null, amount: 3_000_000n, lineageKey: "I" },
  { id: "i1", parentId: "k1", kind: "item", code: "1", name: "Bekesting balok", unit: "m2", volume: 20, unitPrice: 100_000, amount: 2_000_000n, lineageKey: "I#1" },
  { id: "i2", parentId: "i1", kind: "item", code: "2", name: "Pembesian balok", unit: "kg", volume: 10, unitPrice: 100_000, amount: 1_000_000n, lineageKey: "I#1#2" },
];

const INPUT = {
  locationName: "Uji", packageName: "Paket uji", contractNumber: null, vendorName: null,
  revisionNo: 1, revisionId: "rev-uji", totalValue: 3_000_000n, nodes: NODES,
};

async function lembar(input = INPUT) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildAdendumTemplateXlsx(input)) as unknown as ArrayBuffer);
  return { wb, ws: wb.getWorksheet(ADENDUM_TEMPLATE_SHEET)! };
}

function cariBaris(ws: ExcelJS.Worksheet, nama: string): number {
  let hasil = -1;
  ws.eachRow((row, r) => {
    if (row.getCell(2).value === nama) hasil = r;
  });
  expect(hasil, `baris "${nama}"`).toBeGreaterThan(0);
  return hasil;
}

describe("F-2 · induk dibuang, anaknya tidak boleh jadi yatim diam-diam", () => {
  it("HAPUS pada item yang punya anak DITOLAK, bukan menelan uangnya", async () => {
    const { wb, ws } = await lembar();
    // Kolom Keterangan (10) = "HAPUS" pada induk; anaknya dibiarkan utuh.
    ws.getCell(cariBaris(ws, "Bekesting balok"), 10).value = "HAPUS";
    expect(() => parseAdendumTemplate(wb)).toThrow(AdendumTemplateError);
    // Pesannya menyebut baris dan induknya, supaya orangnya tahu harus apa.
    expect(() => parseAdendumTemplate(wb)).toThrow(/Pembesian balok|Bekesting balok/);
  });

  it("volume negatif pada induk berANAK juga DITOLAK", async () => {
    const { wb, ws } = await lembar();
    ws.getCell(cariBaris(ws, "Bekesting balok"), 7).value = -5;
    expect(() => parseAdendumTemplate(wb)).toThrow(AdendumTemplateError);
  });

  it("induk TANPA anak tetap boleh dihapus – pagar ini bukan pemblokir", async () => {
    const { wb, ws } = await lembar();
    ws.getCell(cariBaris(ws, "Pembesian balok"), 10).value = "HAPUS";
    const t = parseAdendumTemplate(wb);
    expect(t.dihapus.map((d) => d.name)).toContain("Pembesian balok");
    // Dan tidak ada satu pun node yang induknya menghilang.
    const kunci = new Set(t.nodes.map((n) => n.lineageKey));
    for (const n of t.nodes) {
      if (n.parentLineageKey) expect(kunci.has(n.parentLineageKey), `induk ${n.parentLineageKey}`).toBe(true);
    }
  });
});

describe("F-3 · dua item baru berkode sama", () => {
  it("tidak menghasilkan lineageKey kembar", async () => {
    const { wb, ws } = await lembar();
    // Dua baris sisipan di bawah kategori I, keduanya berkode "-" (lazim dipakai
    // sebagai bullet). Ditulis di baris kosong sesudah tabel.
    const akhir = cariBaris(ws, "Pembesian balok");
    for (const [i, nama] of [["Urugan pasir"], ["Pasangan batu"]].entries()) {
      const r = akhir + 1 + i;
      ws.getCell(r, 1).value = "-";
      ws.getCell(r, 2).value = nama[0];
      ws.getCell(r, 4).value = "m3";
      ws.getCell(r, 5).value = 200_000;
      ws.getCell(r, 7).value = 3;
    }
    const t = parseAdendumTemplate(wb);
    const kunci = t.nodes.map((n) => n.lineageKey);
    expect(new Set(kunci).size, `lineageKey kembar: ${kunci.join(", ")}`).toBe(kunci.length);
    // Keduanya tetap masuk sebagai item baru – bukan salah satu dibuang.
    expect(t.itemBaru.map((i) => i.name)).toEqual(
      expect.arrayContaining(["Urugan pasir", "Pasangan batu"]),
    );
  });
});
