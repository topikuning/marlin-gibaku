// BERKAS rincian time schedule harus MENGATAKAN apa yang benar (DECISIONS 316).
//
// Uji ini membaca balik workbook yang dihasilkan, bukan memeriksa kode
// penyusunnya. Yang dijaga bukan tata letaknya, melainkan satu hal yang kalau
// hilang membuat dokumen ini berbohong ke pemberi kerja: kolom waktu adalah
// jadwal KATEGORI, bukan jadwal item.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { susunRincian, type SimpulRab } from "@/lib/export/rincian-jadwal";
import type { PeriodHeader } from "@/lib/periodic-report";

const { buildRincianJadwalXlsx } = await import("@/lib/export/rincian-jadwal-xlsx");

const NODES: SimpulRab[] = [
  { id: "k1", parentId: null, kind: "kategori", code: "A", name: "PEKERJAAN PERSIAPAN", volume: null, unit: null, unitPrice: null, amount: 400, lineageKey: "A" },
  { id: "s1", parentId: "k1", kind: "sub", code: "A.1", name: "Mobilisasi", volume: null, unit: null, unitPrice: null, amount: 400, lineageKey: "A.1" },
  { id: "i1", parentId: "s1", kind: "item", code: "A.1.1", name: "Direksi keet", volume: 2, unit: "unit", unitPrice: 100, amount: 200, lineageKey: "A.1.1" },
  { id: "i2", parentId: "s1", kind: "item", code: "A.1.2", name: "Papan nama", volume: 1, unit: "bh", unitPrice: 200, amount: 200, lineageKey: "A.1.2" },
  { id: "k2", parentId: null, kind: "kategori", code: "B", name: "PEKERJAAN STRUKTUR", volume: null, unit: null, unitPrice: null, amount: 600, lineageKey: "B" },
];

const HEADER = {
  locationName: "Batah Timur",
  village: "Batah Timur",
  district: null,
  regency: "Bangkalan",
  province: "Jawa Timur",
  packageName: "KNMP Bangkalan",
  ownerAgency: "KKP",
  contractNumber: "KTR-001",
  vendorName: "PT Gibaku",
  contractValue: 1_000_000n,
  locationValue: 1_000n,
  masaPelaksanaanHari: 150,
  tahunAnggaran: 2026,
  contractStart: new Date("2026-06-01T00:00:00Z"),
  periodeStart: new Date("2026-06-01T00:00:00Z"),
  periodeEnd: new Date("2026-06-07T00:00:00Z"),
  ppkName: null,
  ppkNip: null,
  supervisorName: null,
  supervisorFirm: null,
  contractorSignerName: null,
  contractorSignerTitle: null,
} as unknown as PeriodHeader;

const ROWS = susunRincian(NODES, 1000, [
  { lineageKey: "A", segments: [{ startWeek: 1, endWeek: 4 }] },
  { lineageKey: "B", segments: [{ startWeek: 3, endWeek: 8 }, { startWeek: 11, endWeek: 12 }] },
]);

async function bacaSheet() {
  const buf = await buildRincianJadwalXlsx(ROWS, HEADER, { totalWeeks: 22, origin: "tersimpan" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(buf) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Rincian Time Schedule")!;
  const teks: string[] = [];
  ws.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string") teks.push(cell.value);
    });
  });
  return { ws, teks };
}

describe("berkas rincian time schedule", () => {
  it("MEMPERINGATKAN bahwa kolom waktu adalah jadwal kategori, bukan jadwal item", async () => {
    // Ini asersi terpenting di berkas ini. Tanpa kalimat itu, dokumen yang
    // disetorkan terbaca sebagai pernyataan kapan tiap item dikerjakan —
    // pernyataan yang tidak pernah dibuat siapa pun.
    const { teks } = await bacaSheet();
    const peringatan = teks.find((t) => t.includes("tidak menyimpan jadwal per item"));
    expect(peringatan).toBeTruthy();
    expect(peringatan).toMatch(/KATEGORI INDUK/);
  });

  it("peringatannya muncul SEBELUM tabel, bukan terkubur di bawah ratusan item", async () => {
    const { ws } = await bacaSheet();
    let barisPeringatan = -1;
    let barisKepala = -1;
    ws.eachRow((row, n) => {
      const v = row.getCell(1).value;
      if (typeof v === "string" && v.includes("tidak menyimpan jadwal per item")) barisPeringatan = n;
      if (v === "Kode" && barisKepala < 0) barisKepala = n;
    });
    expect(barisPeringatan).toBeGreaterThan(0);
    expect(barisKepala).toBeGreaterThan(barisPeringatan);
  });

  it("memuat seluruh jenjang: kategori, sub, sampai item", async () => {
    const { teks } = await bacaSheet();
    expect(teks.some((t) => t.includes("PEKERJAAN PERSIAPAN"))).toBe(true);
    expect(teks.some((t) => t.includes("Mobilisasi"))).toBe(true);
    expect(teks.some((t) => t.includes("Direksi keet"))).toBe(true);
    expect(teks.some((t) => t.includes("Papan nama"))).toBe(true);
  });

  it("item membawa jadwal kategori induknya, termasuk jedanya", async () => {
    const { ws } = await bacaSheet();
    const jadwalKolom = 8;
    const cari = (kode: string) => {
      let hasil: unknown = null;
      ws.eachRow((row) => {
        if (row.getCell(1).value === kode) hasil = row.getCell(jadwalKolom).value;
      });
      return hasil;
    };
    expect(cari("A.1.1")).toBe("M1–M4");
    expect(cari("B")).toBe("M3–M8, M11–M12");
  });

  it("TOTAL hanya menjumlah kategori — 100%, bukan 200%", async () => {
    // Menjumlahkan semua baris akan menghitung ganda (kategori + anaknya).
    const { ws } = await bacaSheet();
    let bobot: unknown = null;
    ws.eachRow((row) => {
      if (String(row.getCell(2).value ?? "").startsWith("TOTAL")) bobot = row.getCell(7).value;
    });
    expect(Number(bobot)).toBeCloseTo(100);
  });

  it("menyebutkan asal jadwalnya supaya pembaca tahu ini baseline atau derivasi", async () => {
    const buf = await buildRincianJadwalXlsx(ROWS, HEADER, { totalWeeks: 22, origin: "otomatis" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(buf) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Rincian Time Schedule")!;
    const teks: string[] = [];
    ws.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === "string") teks.push(cell.value);
      });
    });
    expect(teks.some((t) => t.includes("derivasi otomatis"))).toBe(true);
  });

  it("berkop resmi: judul, identitas paket, dan blok tanda tangan KKP", async () => {
    const { teks } = await bacaSheet();
    expect(teks.some((t) => t.includes("RINCIAN TIME SCHEDULE"))).toBe(true);
    expect(teks.some((t) => t.includes("KNMP Bangkalan"))).toBe(true);
    // Blok tanda tangan tiga pihak — berkas ini disetorkan ke pemberi kerja.
    expect(teks.some((t) => /Mengetahui/i.test(t))).toBe(true);
    expect(teks.some((t) => /Dibuat/i.test(t))).toBe(true);
  });
});
