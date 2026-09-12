// TEMPLATE ADENDUM YANG DIBUAT DARI RAB LAIN HARUS DITOLAK, BUKAN DI-DIFF.
//
// Dilaporkan user 2026-09-12 dengan tangkapan layar: template terbitan MARLIN
// sendiri, diimpor ke draft adendum, dan pratinjaunya berbunyi
//
//   676 item baru · 52 volume berubah · 676 item hilang · 175 tetap
//   140 item yang SUDAH dikerjakan tidak ada di file ini
//
// Angka 676 yang muncul DUA KALI bukan perubahan data — itu identitas yang
// tidak saling kenal. Sebabnya tertulis di berkasnya sendiri, baris 3:
// *"Disalin dari RAB revisi aktif #1"*, sementara yang aktif saat diimpor
// revisi lain (kategorinya `VI.1`/`VII.1`/`X.1`, template-nya `VI`/`VII`/`X`).
//
// Nomor revisinya SUDAH ditulis sejak dulu — tapi sebagai kalimat untuk dibaca
// manusia, dan tidak pernah diperiksa mesin. Berkas bolak-balik yang mencatat
// dasarnya lalu mengabaikan catatannya sendiri lebih buruk daripada yang tidak
// mencatat sama sekali: ia terlihat aman.
//
// Yang dijaga di sini: dasarnya ditulis agar BISA dibaca mesin, dan yang tidak
// cocok DITOLAK dengan menyebut kedua nomornya.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";

const { buildAdendumTemplateXlsx } = await import("@/lib/export/adendum-template-xlsx");
const { sumberRevisiTemplate } = await import("@/lib/rab/adendum-template-parse");

const NODES = [
  {
    id: "k1",
    parentId: null,
    kind: "kategori" as const,
    code: "I",
    name: "PEKERJAAN PERSIAPAN",
    unit: null,
    volume: null,
    unitPrice: null,
    amount: 1_000_000n,
    lineageKey: "I",
  },
  {
    id: "i1",
    parentId: "k1",
    kind: "item" as const,
    code: "1",
    name: "Bedeng pekerja",
    unit: "m2",
    volume: 10,
    unitPrice: 100_000,
    amount: 1_000_000n,
    lineageKey: "I#1",
  },
];

async function template(revisionNo: number, revisionId: string) {
  const buf = await buildAdendumTemplateXlsx({
    locationName: "Situbondo",
    packageName: "Pesisir",
    contractNumber: "B.123",
    vendorName: "CV. Tosan",
    revisionNo,
    revisionId,
    totalValue: 1_000_000n,
    realisasiByLineage: new Map(),
    nodes: NODES,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe("template adendum membawa dasarnya sendiri", () => {
  it("revisi asal terbaca MESIN, bukan cuma tercetak untuk dibaca orang", async () => {
    const wb = await template(3, "rev-abc");
    expect(sumberRevisiTemplate(wb)).toEqual({ revisionNo: 3, revisionId: "rev-abc" });
  });

  it("template lama (tanpa penanda mesin) tetap terbaca dari barisan judulnya", async () => {
    // Berkas yang SUDAH beredar tidak punya penanda baru itu. Membiarkannya
    // lolos berarti cacat yang dilaporkan user hari ini tetap terjadi pada
    // berkas yang sudah terlanjur diunduh — dan justru itu yang ada di tangan
    // orang sekarang.
    const wb = await template(1, "rev-lama");
    wb.getWorksheet("Template Adendum")!.getCell(7, 12).value = null; // penanda mesin dihapus
    expect(sumberRevisiTemplate(wb)).toEqual({ revisionNo: 1, revisionId: null });
  });

  it("bukan template sama sekali → null, bukan tebakan", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("RAB");
    expect(sumberRevisiTemplate(wb)).toBeNull();
  });
});
