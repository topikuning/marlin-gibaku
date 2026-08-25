import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { matchRows, parseRecapWorkbook, type RecapLeaf } from "@/lib/daily-report/recap-parse";

/**
 * Impor rekap laporan harian: parser Excel (deteksi header fleksibel + tanggal)
 * dan pencocokan murni ke leaf RAB + penandaan masalah. DECISIONS 114.
 */

async function buildRecap(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rekap");
  ws.addRow(["Rekap Laporan Harian – Lokasi Uji"]); // baris judul (harus dilewati)
  ws.addRow(["Tanggal", "Kode", "Uraian Pekerjaan", "Volume"]); // header
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const leaves: RecapLeaf[] = [
  { id: "n1", code: "1.1", name: "Galian Tanah", unit: "m3", volume: 100, unitPrice: 50_000, lineageKey: "lk1", doneCumulative: 0 },
  { id: "n2", code: "2.1", name: "Pasangan Batu Kali", unit: "m3", volume: 50, unitPrice: 800_000, lineageKey: "lk2", doneCumulative: 40 },
];

describe("parseRecapWorkbook", () => {
  it("melewati baris judul, mendeteksi header, dan membaca tanggal + volume", async () => {
    const buf = await buildRecap([
      ["2026-07-12", "1.1", "Galian Tanah", 30],
      ["12/07/2026", "2.1", "Pasangan Batu Kali", 5], // format DD/MM/YYYY
    ]);
    const rows = await parseRecapWorkbook(buf);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ dateKey: "2026-07-12", code: "1.1", name: "Galian Tanah", volume: 30 });
    expect(rows[1].dateKey).toBe("2026-07-12");
  });

  it("melempar bila header tak ditemukan", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("X");
    ws.addRow(["foo", "bar", "baz"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseRecapWorkbook(buf)).rejects.toThrow(/Header/i);
  });
});

describe("matchRows", () => {
  const today = "2026-07-25";

  it("cocok via kode dan via nama", () => {
    const rows = [
      { rowNum: 3, rawDate: "2026-07-12", dateKey: "2026-07-12", code: "1.1", name: "Galian Tanah", volume: 30 },
      { rowNum: 4, rawDate: "2026-07-13", dateKey: "2026-07-13", code: "", name: "pasangan batu kali", volume: 5 },
    ];
    const out = matchRows(rows, leaves, today);
    expect(out[0]).toMatchObject({ status: "ok", matchedNodeId: "n1" });
    expect(out[1]).toMatchObject({ status: "ok", matchedNodeId: "n2" });
    // valueDone = 30 * 50000
    expect(out[0].valueDone).toBe(1_500_000);
  });

  it("menandai over_volume secara kumulatif lintas baris (termasuk realisasi lama)", () => {
    const rows = [
      { rowNum: 3, rawDate: "2026-07-13", dateKey: "2026-07-13", code: "2.1", name: "Pasangan Batu Kali", volume: 5 }, // 40+5=45 ok
      { rowNum: 4, rawDate: "2026-07-14", dateKey: "2026-07-14", code: "2.1", name: "Pasangan Batu Kali", volume: 8 }, // 45+8=53 > 50
    ];
    const out = matchRows(rows, leaves, today);
    expect(out[0].status).toBe("ok");
    expect(out[1].status).toBe("over_volume");
  });

  it("menandai unmatched, bad_date, future_date, zero_volume", () => {
    const rows = [
      { rowNum: 3, rawDate: "2026-07-15", dateKey: "2026-07-15", code: "", name: "Pekerjaan Tidak Ada", volume: 3 },
      { rowNum: 4, rawDate: "bukan tanggal", dateKey: null, code: "1.1", name: "Galian Tanah", volume: 2 },
      { rowNum: 5, rawDate: "2030-01-01", dateKey: "2030-01-01", code: "1.1", name: "Galian Tanah", volume: 2 },
      { rowNum: 6, rawDate: "2026-07-16", dateKey: "2026-07-16", code: "1.1", name: "Galian Tanah", volume: 0 },
    ];
    const out = matchRows(rows, leaves, today);
    expect(out[0].status).toBe("unmatched");
    expect(out[1].status).toBe("bad_date");
    expect(out[2].status).toBe("future_date");
    expect(out[3].status).toBe("zero_volume");
  });
});
