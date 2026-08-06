import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildJadwalXlsx } from "@/lib/export/xlsx";
import type { PeriodReport } from "@/lib/periodic-report";

/**
 * Kolom "Bobot (%)" sheet Kurva S wajib berupa RUMUS `=SUM(kolom minggu)` —
 * bukan angka tempelan — dan rumus itu harus JUJUR: Σ sel minggu yang benar-benar
 * tertulis = nilai cache-nya = bobot kategori.
 */

const N = 7;
const spread = (total: number, weeks: number[]) => {
  const w = new Array<number>(N).fill(0);
  for (const i of weeks) w[i] = total / weeks.length;
  return w;
};

function fixture(): PeriodReport {
  const start = new Date(Date.UTC(2026, 3, 1));
  return {
    kind: "mingguan",
    n: 3,
    maxN: N,
    totalWeeks: N,
    totalMonths: 2,
    header: {
      locationName: "Lokasi Uji",
      village: "Pengaradan",
      district: "Tanjung",
      regency: "Brebes",
      province: "Jawa Tengah",
      packageName: "Paket Uji KNMP",
      ownerAgency: "KKP",
      contractNumber: "001/KNMP/2026",
      vendorName: "CV Uji",
      contractValue: 1_000_000_000n,
      locationValue: 1_000_000_000n,
      masaPelaksanaanHari: N * 7,
      tahunAnggaran: 2026,
      contractStart: start,
      periodeStart: start,
      periodeEnd: new Date(start.getTime() + 6 * 86_400_000),
      ppkName: null,
      ppkNip: null,
      supervisorName: null,
      supervisorFirm: null,
      contractorSignerName: null,
      contractorSignerTitle: null,
    },
    categories: [],
    totals: { bobotLalu: 0, bobotIni: 0, bobotSd: 0, bobotRencana: 0 },
    planPct: 20,
    planPrevPct: 12,
    actualPct: 15,
    deviationPct: -5,
    scurve: {
      planPct: [5, 12, 20, 40, 60, 85, 100],
      actualPct: [4, 10, 15, null, null, null, null],
      currentWeek: 3,
    },
    // Angka yang tidak habis dibagi — memaksa pembulatan per sel.
    kurvaSchedule: [
      { lineageKey: "I", code: "I", name: "PEKERJAAN PERSIAPAN", weekly: spread(4.33, [0, 1, 2, 3, 4, 5, 6]) },
      { lineageKey: "II", code: "II", name: "PEKERJAAN TAMBATAN PERAHU", weekly: spread(11.19, [2, 3, 4]) },
      { lineageKey: "III", code: "III", name: "PEKERJAAN KANTOR PENGELOLA", weekly: spread(84.48, [1, 2, 3, 4, 5, 6]) },
    ],
    tenaga: [],
    material: [],
    alat: [],
    cuacaRingkas: "",
    kendala: [],
  };
}

const numOf = (v: ExcelJS.CellValue): number => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v) return Number((v as { result: unknown }).result ?? 0);
  return 0;
};

describe("sheet Kurva S — kolom Bobot (%) = SUM kolom minggu", () => {
  it("tiap baris kategori: rumus SUM(D:J), dan Σ sel minggu yang tertulis = hasilnya", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildJadwalXlsx(fixture())) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Time Schedule")!;
    expect(ws).toBeTruthy();

    // Cari baris kategori lewat kode romawi di kolom A.
    const catRows: number[] = [];
    ws.eachRow((row, r) => {
      if (["I", "II", "III"].includes(String(row.getCell(1).value ?? ""))) catRows.push(r);
    });
    expect(catRows).toHaveLength(3);

    let totalBobot = 0;
    for (const r of catRows) {
      const cell = ws.getRow(r).getCell(3).value as { formula?: string; result?: number } | null;
      expect(cell, `baris ${r}`).toBeTruthy();
      expect(cell!.formula, `baris ${r}`).toBe(`SUM(D${r}:J${r})`);

      // Rumus tidak boleh berbohong: jumlahkan sel minggu yang BENAR-BENAR ditulis.
      let sumWeeks = 0;
      for (let c = 4; c <= 3 + N; c++) sumWeeks += numOf(ws.getRow(r).getCell(c).value);
      expect(sumWeeks, `baris ${r} · Σ minggu vs cache rumus`).toBeCloseTo(cell!.result as number, 9);
      totalBobot += cell!.result as number;
    }
    expect(totalBobot, "Σ bobot kategori").toBeCloseTo(100, 9);
  });

  it("baris Kumulatif Rencana: sel bobot = SUM kolom bobot kategori (bukan 100 tempelan)", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildJadwalXlsx(fixture())) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Time Schedule")!;

    let totalRow = 0;
    ws.eachRow((row, r) => {
      if (String(row.getCell(1).value ?? "").startsWith("Kumulatif Rencana")) totalRow = r;
    });
    expect(totalRow).toBeGreaterThan(0);

    const cell = ws.getRow(totalRow).getCell(3).value as { formula?: string; result?: number };
    expect(cell.formula).toMatch(/^SUM\(C\d+:C\d+\)$/);
    expect(cell.result).toBeCloseTo(100, 9);
  });

  it("baris Rencana & Kumulatif Rencana tetap RUMUS (bukan angka statik)", async () => {
    // Pernah terkunci jadi angka statik saat audit B3; dikembalikan atas
    // keputusan user (DECISIONS 158). Uji ini yang menahannya supaya tidak
    // diam-diam mati lagi.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildJadwalXlsx(fixture())) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Time Schedule")!;

    const rowOf = (label: string) => {
      let found = 0;
      ws.eachRow((row, r) => {
        if (String(row.getCell(1).value ?? "") === label) found = r;
      });
      return found;
    };
    const rencanaRow = rowOf("Rencana Prestasi %");
    const kumRow = rowOf("Kumulatif Rencana Prestasi %");
    expect(rencanaRow).toBeGreaterThan(0);
    expect(kumRow).toBeGreaterThan(0);

    for (let i = 0; i < N; i++) {
      const col = 4 + i;
      const rencana = ws.getRow(rencanaRow).getCell(col).value as { formula?: string; result?: number };
      expect(rencana?.formula, `rencana M${i + 1}`).toMatch(/^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/);
      const kum = ws.getRow(kumRow).getCell(col).value as { formula?: string; result?: number };
      expect(kum?.formula, `kumulatif M${i + 1}`).toBeTruthy();

      // Cache tidak boleh berbohong: = Σ sel kategori kolom itu.
      let sumCat = 0;
      ws.eachRow((row, r) => {
        if (r > 0 && r < rencanaRow && ["I", "II", "III"].includes(String(row.getCell(1).value ?? ""))) {
          sumCat += numOf(row.getCell(col).value);
        }
      });
      expect(rencana.result as number, `rencana M${i + 1} cache`).toBeCloseTo(sumCat, 2);
    }
  });
});
