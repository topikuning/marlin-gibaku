import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { addLineChartToXlsx, colLetter, type LineChartSpec } from "@/lib/export/xlsx-chart";

async function baseWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Kurva S");
  ws.addRow([0, 1, 2, 3]); // baris 1: X (origin 0 + minggu 1..3)
  ws.addRow([0, 10, 40, 100]); // baris 2: Y kumulatif rencana
  ws.addRow([0, 8, 25, null]); // baris 3: Y kumulatif realisasi (berhenti)
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const spec: LineChartSpec = {
  sheetName: "Kurva S",
  xMax: 3,
  series: [
    { name: "Rencana", xRef: "'Kurva S'!$A$1:$D$1", yRef: "'Kurva S'!$A$2:$D$2", color: "2563EB" },
    { name: "Realisasi", xRef: "'Kurva S'!$A$1:$D$1", yRef: "'Kurva S'!$A$3:$D$3", color: "16A34A" },
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

    // Chart SCATTER (XY) mereferensikan X (origin+minggu) & Y (kumulatif), bukan gambar.
    const chart = await zip.file("xl/charts/chart1.xml")!.async("string");
    expect(chart).toContain("<c:scatterChart>");
    expect(chart).toContain("<c:xVal><c:numRef><c:f>'Kurva S'!$A$1:$D$1</c:f>");
    expect(chart).toContain("<c:yVal><c:numRef><c:f>'Kurva S'!$A$2:$D$2</c:f>");
    expect(chart).toContain("<c:yVal><c:numRef><c:f>'Kurva S'!$A$3:$D$3</c:f>");
    expect(chart).toContain("dispBlanksAs val=\"gap\""); // realisasi berhenti = gap, bukan 0
    expect(chart).toContain("plotVisOnly val=\"0\""); // baris helper tersembunyi tetap diplot
    // Mode OVERLAY: latar transparan + sumbu disembunyikan (delete=1) + plot penuh.
    expect(chart).toContain("<a:noFill/>"); // chart & plot area transparan
    expect(chart).toContain("<c:manualLayout>"); // plot diisi penuh frame
    expect((chart.match(/<c:delete val="1"\/>/g) ?? []).length).toBe(2); // kedua sumbu disembunyikan

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
