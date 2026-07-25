import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { addLineChartToXlsx, colLetter, type LineChartSpec } from "@/lib/export/xlsx-chart";

async function baseWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Kurva S");
  ws.addRow(["", "", "", "M1", "M2", "M3"]); // baris 1: label minggu (D:F)
  ws.addRow(["", "", "", 10, 40, 100]); // baris 2: kumulatif rencana
  ws.addRow(["", "", "", 8, 25, null]); // baris 3: kumulatif realisasi (berhenti)
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const spec: LineChartSpec = {
  sheetName: "Kurva S",
  title: "KURVA S",
  catRef: "'Kurva S'!$D$1:$F$1",
  series: [
    { name: "Rencana", valRef: "'Kurva S'!$D$2:$F$2", color: "64748B", dash: true },
    { name: "Realisasi", valRef: "'Kurva S'!$D$3:$F$3", color: "16A34A" },
  ],
  anchor: { fromCol: 1, fromRow: 5, toCol: 10, toRow: 25 },
};

describe("addLineChartToXlsx", () => {
  it("menyuntikkan part chart + drawing native dan menyambungkan relasinya", async () => {
    const out = await addLineChartToXlsx(await baseWorkbook(), spec);
    const zip = await JSZip.loadAsync(out);

    // Part native ada.
    expect(zip.file("xl/charts/chart1.xml")).not.toBeNull();
    expect(zip.file("xl/drawings/drawing1.xml")).not.toBeNull();

    // Content-types mendaftarkan keduanya (kalau tidak, Excel menolak file).
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain("/xl/charts/chart1.xml");
    expect(ct).toContain("/xl/drawings/drawing1.xml");

    // Worksheet menautkan <drawing>, dan rels-nya menunjuk ke drawing part.
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toMatch(/<drawing r:id="rId\d+"\/>/);
    const rels = await zip.file("xl/worksheets/_rels/sheet1.xml.rels")!.async("string");
    expect(rels).toContain("../drawings/drawing1.xml");

    // Chart mereferensikan sel yang benar (deret + kategori), bukan gambar.
    const chart = await zip.file("xl/charts/chart1.xml")!.async("string");
    expect(chart).toContain("<c:lineChart>");
    expect(chart).toContain("'Kurva S'!$D$2:$F$2");
    expect(chart).toContain("'Kurva S'!$D$3:$F$3");
    expect(chart).toContain("'Kurva S'!$D$1:$F$1");
    expect(chart).toContain("dispBlanksAs val=\"gap\""); // realisasi berhenti = gap, bukan 0

    // exceljs masih bisa memuat ulang workbook (konsistensi part-level).
    const reload = new ExcelJS.Workbook();
    await expect(
      reload.xlsx.load(out as unknown as Parameters<typeof reload.xlsx.load>[0]),
    ).resolves.toBeDefined();
  });

  it("mengembalikan buffer apa adanya bila sheet tak ditemukan", async () => {
    const base = await baseWorkbook();
    const out = await addLineChartToXlsx(base, { ...spec, sheetName: "Tidak Ada" });
    expect(out).toBe(base);
  });

  it("colLetter memetakan indeks kolom 1-based ke huruf Excel", () => {
    expect(colLetter(1)).toBe("A");
    expect(colLetter(4)).toBe("D");
    expect(colLetter(26)).toBe("Z");
    expect(colLetter(27)).toBe("AA");
  });
});
