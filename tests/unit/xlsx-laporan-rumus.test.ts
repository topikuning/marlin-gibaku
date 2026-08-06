import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildPeriodReportXlsx } from "@/lib/export/xlsx";
import type { PeriodItemRow, PeriodReport } from "@/lib/periodic-report";

/**
 * Sheet "Laporan": angka yang bisa DIHITUNG harus berupa rumus, bukan tempelan —
 * kolom Sisa Pekerjaan, ringkasan Rencana/Realisasi/Deviasi di kepala dokumen,
 * dan bobot di baris judul kategori. Plus: nilai identitas panjang (nama paket
 * KKP) tidak boleh terpotong.
 */

const PAKET =
  "Pekerjaan Konstruksi Pembangunan Kampung Nelayan Merah Putih di Provinsi Jawa Tengah — Paket 3";

const item = (over: Partial<PeriodItemRow> & { no: number; name: string }): PeriodItemRow => ({
  code: "",
  volK: 100,
  unit: "m3",
  unitPrice: 250_000,
  amount: 25_000_000,
  bobot: 10,
  volLalu: 10,
  prestasiLalu: 10,
  bobotLalu: 1,
  volIni: 15,
  prestasiIni: 15,
  bobotIni: 1.5,
  volSd: 25,
  prestasiSd: 25,
  bobotSd: 2.5,
  bobotRencana: 3,
  sisaVol: 75,
  sisaPrestasi: 75,
  ...over,
});

function fixture(): PeriodReport {
  const start = new Date(Date.UTC(2026, 6, 22));
  const rows = [
    item({ no: 1, name: "Pembersihan lahan", volK: 120, volSd: 30, prestasiSd: 25, sisaVol: 90, sisaPrestasi: 75 }),
    item({ no: 2, name: "Pengukuran & bouwplank", volK: 80, volSd: 80, prestasiSd: 100, sisaVol: 0, sisaPrestasi: 0 }),
  ];
  return {
    kind: "mingguan",
    n: 1,
    maxN: 20,
    totalWeeks: 20,
    totalMonths: 5,
    header: {
      locationName: "Pasar Banggi",
      village: "Pasar Banggi",
      district: null,
      regency: "Rembang",
      province: "Jawa Tengah",
      packageName: PAKET,
      ownerAgency: "KKP",
      contractNumber: "B.17105/DJPT.6/PI.420/PPK/VI/2026",
      vendorName: "PT Kurnia Alam Sentosa",
      contractValue: 5_872_342_857n,
      locationValue: 5_872_342_857n,
      masaPelaksanaanHari: 135,
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
    categories: [
      {
        code: "I",
        name: "PEKERJAAN PERSIAPAN",
        rows,
        subtotalAmount: 50_000_000,
        subtotalBobot: 20,
        subtotalBobotLalu: 2,
        subtotalBobotIni: 3,
        subtotalBobotSd: 5,
        subtotalBobotRencana: 6,
      },
    ],
    totals: { bobotLalu: 2, bobotIni: 3, bobotSd: 5, bobotRencana: 6 },
    planPct: 6,
    planPrevPct: 0,
    actualPct: 5,
    deviationPct: -1,
    scurve: { planPct: [6], actualPct: [5], currentWeek: 1 },
    kurvaSchedule: [{ code: "I", name: "PEKERJAAN PERSIAPAN", weekly: Array.from({ length: 20 }, () => 5) }],
    tenaga: [],
    material: [],
    alat: [],
    cuacaRingkas: "",
    kendala: [],
  };
}

async function sheet() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildPeriodReportXlsx(fixture())) as unknown as ArrayBuffer);
  return wb.getWorksheet("Laporan")!;
}

const cellText = (v: ExcelJS.CellValue): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "richText" in v
    ? (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("")
    : String(v ?? "");

const rowWithLabel = (ws: ExcelJS.Worksheet, label: string): number => {
  let found = 0;
  ws.eachRow((row, r) => {
    if (cellText(row.getCell(1).value) === label) found = r;
  });
  return found;
};

describe("sheet Laporan — identitas tidak terpotong", () => {
  it("nilai identitas dimerge sampai kolom terakhir tabel dan teksnya utuh", async () => {
    const ws = await sheet();
    const r = rowWithLabel(ws, "Paket Pekerjaan");
    expect(r).toBeGreaterThan(0);
    // Teks tersimpan utuh — tidak dipotong saat menulis.
    expect(cellText(ws.getRow(r).getCell(3).value)).toBe(PAKET);
    // Sel gabungan membentang sampai kolom terakhir tabel (S = 19), bukan H.
    const merges = (ws.model as unknown as { merges: string[] }).merges ?? [];
    expect(merges, "merge blok identitas").toContain(`C${r}:S${r}`);
  });
});

describe("sheet Laporan — angka terhitung memakai rumus", () => {
  it("kolom Sisa Pekerjaan = MAX(0, ...) atas sel di barisnya, cache cocok", async () => {
    const ws = await sheet();
    // Baris item = punya nomor urut angka di kolom A.
    const itemRows: number[] = [];
    ws.eachRow((row, r) => {
      if (typeof row.getCell(1).value === "number") itemRows.push(r);
    });
    expect(itemRows.length).toBe(2);

    for (const r of itemRows) {
      const prestasi = ws.getRow(r).getCell(18).value as { formula?: string; result?: number };
      const volume = ws.getRow(r).getCell(19).value as { formula?: string; result?: number };
      expect(prestasi.formula, `sisa prestasi baris ${r}`).toBe(`MAX(0,100-O${r})`);
      expect(volume.formula, `sisa volume baris ${r}`).toBe(`MAX(0,C${r}-N${r})`);

      // Rumus tidak berbohong: hitung ulang dari sel yang benar-benar ditulis.
      const volK = Number(ws.getRow(r).getCell(3).value);
      const volSd = Number(ws.getRow(r).getCell(14).value);
      const prestasiSd = Number(ws.getRow(r).getCell(15).value);
      // exceljs tidak menulis cache saat hasilnya 0 — nilai hilang = 0.
      expect(prestasi.result ?? 0).toBeCloseTo(Math.max(0, 100 - prestasiSd), 6);
      expect(volume.result ?? 0).toBeCloseTo(Math.max(0, volK - volSd), 6);
    }
  });

  it("Rencana/Realisasi/Deviasi di kepala dokumen tertaut ke baris JUMLAH", async () => {
    const ws = await sheet();
    let jumlahRow = 0;
    ws.eachRow((row, r) => {
      if (cellText(row.getCell(2).value) === "JUMLAH") jumlahRow = r;
    });
    expect(jumlahRow).toBeGreaterThan(0);

    const rRencana = rowWithLabel(ws, "Rencana s/d periode (%)");
    const rReal = rowWithLabel(ws, "Realisasi s/d periode (%)");
    const rDev = rowWithLabel(ws, "Deviasi (%)");

    const fRencana = ws.getRow(rRencana).getCell(3).value as { formula?: string; result?: number };
    const fReal = ws.getRow(rReal).getCell(3).value as { formula?: string; result?: number };
    const fDev = ws.getRow(rDev).getCell(3).value as { formula?: string; result?: number };

    expect(fRencana.formula).toBe(`Q${jumlahRow}`); // JUMLAH kolom Bobot Rencana
    expect(fReal.formula).toBe(`P${jumlahRow}`); // JUMLAH kolom Bobot S/d
    expect(fDev.formula).toBe(`C${rReal}-C${rRencana}`);
    expect(fDev.result).toBeCloseTo((fReal.result as number) - (fRencana.result as number), 6);
  });

  it("bobot di baris judul kategori mengikuti sel subtotalnya", async () => {
    const ws = await sheet();
    let judul = 0;
    let subtotal = 0;
    ws.eachRow((row, r) => {
      if (cellText(row.getCell(1).value) === "I") judul = r;
      if (cellText(row.getCell(2).value).startsWith("Subtotal ")) subtotal = r;
    });
    expect(judul).toBeGreaterThan(0);
    expect(subtotal).toBeGreaterThan(judul);
    const bobot = ws.getRow(judul).getCell(7).value as { formula?: string };
    expect(bobot.formula).toBe(`G${subtotal}`);
  });
});
