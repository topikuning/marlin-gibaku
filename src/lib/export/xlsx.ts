import "server-only";
import ExcelJS from "exceljs";
import type { PeriodReport } from "@/lib/periodic-report";
import { buildKurvaSheet } from "@/lib/scurve/kkp-sheet";
import { addLineChartToXlsx, colLetter, type LineChartSpec } from "@/lib/export/xlsx-chart";
import { formatTanggal } from "@/lib/format";

/**
 * Export laporan periodik ke .xlsx (exceljs, server-side — BUKAN AG Grid export).
 * Sheet-1 "Kurva S": tabel bobot kategori × minggu + baris prestasi + GAMBAR grafik
 * kurva-S (setara halaman-1 PDF). Sheet-2 "Laporan": header identitas → tabel item
 * per kategori → totals. Format angka #,##0.00 agar konsisten di Excel Indonesia.
 */

const NUM_FMT = "#,##0.00";
const RUPIAH_FMT = "#,##0";

const COLUMNS = [
  { header: "No", width: 5 },
  { header: "Uraian Pekerjaan", width: 48 },
  { header: "Vol. Kontrak", width: 12 },
  { header: "Sat.", width: 8 },
  { header: "Harga Satuan", width: 14 },
  { header: "Bobot %", width: 9 },
  { header: "Vol Lalu", width: 11 },
  { header: "% Lalu", width: 9 },
  { header: "Vol Ini", width: 11 },
  { header: "% Ini", width: 9 },
  { header: "Vol S/d", width: 11 },
  { header: "% S/d", width: 9 },
  { header: "Bobot S/d %", width: 11 },
  { header: "Sisa Vol", width: 11 },
  { header: "Sisa %", width: 9 },
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Sheet-1 "Kurva S": tabel bobot kategori × minggu (increment) + baris prestasi
 * (rencana/realisasi kumulatif + deviasi) + GAMBAR grafik kurva-S. Angka identik
 * dgn tabel KKP & kurva PDF (satu sumber, buildKurvaSheet).
 */
async function addKurvaSheet(
  wb: ExcelJS.Workbook,
  r: PeriodReport,
  opts?: { sheetName?: string },
): Promise<LineChartSpec> {
  const sheet = buildKurvaSheet({
    categories: r.kurvaSchedule,
    totalWeeks: r.totalWeeks,
    contractStart: r.header.contractStart,
    actualCum: r.scurve.actualPct,
    currentWeek: r.scurve.currentWeek,
  });
  const N = sheet.totalWeeks;
  const FIRST = 4; // A=No, B=Uraian, C=Bobot, D.. = minggu
  const lastCol = 3 + N;
  const ketCol = lastCol + 1; // kolom skala 0–100% (KETERANGAN) di kanan
  const ws = wb.addWorksheet(opts?.sheetName ?? "Kurva S", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 5 }, { width: 40 }, { width: 9 }, ...Array.from({ length: N }, () => ({ width: 6 })), { width: 8 }];

  const thin = { style: "thin" as const };
  const box = { top: thin, bottom: thin, left: thin, right: thin };

  const banner = (text: string, bold: boolean, size: number) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, ketCol);
    row.getCell(1).font = { bold, size };
    row.getCell(1).alignment = { horizontal: "center" };
  };
  banner(`KURVA S — ${r.kind === "mingguan" ? `MINGGU KE-${r.n}` : `BULAN KE-${r.n}`}`, true, 12);
  banner(`${r.header.packageName} — ${r.header.village}, ${r.header.regency}`, false, 10);
  ws.addRow([]);

  // Header 2 baris: kelompok bulan (merge) + minggu.
  const monthRow = ws.addRow([]);
  monthRow.getCell(1).value = "No";
  monthRow.getCell(2).value = "Uraian Pekerjaan";
  monthRow.getCell(3).value = "Bobot (%)";
  let c = FIRST;
  for (const g of sheet.monthGroups) {
    monthRow.getCell(c).value = g.label;
    if (g.span > 1) ws.mergeCells(monthRow.number, c, monthRow.number, c + g.span - 1);
    c += g.span;
  }
  const weekRow = ws.addRow([]);
  for (let i = 0; i < N; i++) weekRow.getCell(FIRST + i).value = `M${i + 1}`;
  ws.mergeCells(monthRow.number, 1, weekRow.number, 1);
  ws.mergeCells(monthRow.number, 2, weekRow.number, 2);
  ws.mergeCells(monthRow.number, 3, weekRow.number, 3);
  monthRow.getCell(ketCol).value = "KET";
  ws.mergeCells(monthRow.number, ketCol, weekRow.number, ketCol); // header KET 2 baris
  for (const row of [monthRow, weekRow]) {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > ketCol) return;
      cell.font = { bold: true, size: 8 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      cell.border = box;
    });
  }

  // Baris kategori (bobot + increment mingguan).
  const catRowNums: number[] = [];
  for (const cat of sheet.categories) {
    const row = ws.addRow([cat.code, cat.name, round2(cat.bobot), ...cat.weekly.map((v) => (v >= 0.0005 ? round3(v) : null))]);
    catRowNums.push(row.number);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > lastCol) return;
      cell.border = box;
      cell.font = { size: 8, bold: col === 2 };
      if (col === 1) cell.alignment = { horizontal: "center" };
      else if (col === 3) { cell.alignment = { horizontal: "center" }; cell.numFmt = "#,##0.00"; }
      else if (col >= FIRST) { cell.alignment = { horizontal: "right" }; cell.numFmt = "#,##0.000"; }
    });
    // Sel KET (skala 0–100%) — garis sumbu kiri tebal supaya terbaca sbg sumbu.
    const ket = row.getCell(ketCol);
    ket.border = { ...box, left: { style: "medium" } };
  }

  // Baris prestasi (kumulatif rencana/realisasi + deviasi).
  const prestasi: [string, (number | null)[], boolean][] = [
    ["Rencana Prestasi %", sheet.rencanaPerWeek, false],
    ["Kumulatif Rencana Prestasi %", sheet.kumulatifRencana, true],
    ["Realisasi Prestasi %", sheet.realisasiPerWeek, false],
    ["Kumulatif Realisasi Prestasi %", sheet.kumulatifRealisasi, true],
    ["Deviasi +/-", sheet.deviasi, true],
  ];
  for (const [label, arr, bold] of prestasi) {
    const row = ws.addRow([]);
    row.getCell(1).value = label;
    ws.mergeCells(row.number, 1, row.number, 3);
    row.getCell(1).alignment = { horizontal: "right" };
    row.getCell(1).font = { size: 8, bold };
    row.getCell(1).border = box;
    for (let i = 0; i < N; i++) {
      const cell = row.getCell(FIRST + i);
      cell.value = arr[i] == null ? null : round2(arr[i] as number);
      cell.numFmt = "#,##0.00";
      cell.alignment = { horizontal: "right" };
      cell.font = { size: 8, bold };
      cell.border = box;
    }
    row.getCell(ketCol).border = box; // KET tetap berpetak di baris prestasi
  }

  // Skala 0–100% di kolom KET, sejajar rentang vertikal kurva (baris kategori):
  // 100 di atas baris pertama, 0 di bawah baris terakhir, 75/50/25 proporsional.
  const M = catRowNums.length;
  if (M > 0) {
    const marks: [number, number, "top" | "middle" | "bottom"][] = [
      [100, catRowNums[0], "top"],
      [0, catRowNums[M - 1], "bottom"],
    ];
    if (M >= 3) marks.push([50, catRowNums[Math.round((M - 1) / 2)], "middle"]);
    if (M >= 6) {
      marks.push([75, catRowNums[Math.round((M - 1) * 0.25)], "middle"]);
      marks.push([25, catRowNums[Math.round((M - 1) * 0.75)], "middle"]);
    }
    for (const [val, rowN, vAlign] of marks) {
      const cell = ws.getRow(rowN).getCell(ketCol);
      cell.value = val;
      cell.numFmt = '0"%"';
      cell.font = { size: 8, bold: true, color: { argb: "FF475569" } };
      cell.alignment = { horizontal: "right", vertical: vAlign };
    }
  }

  // Data helper (baris TERSEMBUNYI) utk chart scatter: titik origin (X=0, Y=0%) +
  // kumulatif per akhir-minggu (X=1..N). Scatter dipilih (bukan line/kategori) supaya
  // kurva MULAI dari 0% di kiri-bawah & X menembus tepi kolom minggu (w/N). `plotVisOnly=0`
  // di chartXml → baris tersembunyi ini tetap diplot.
  const helperX = ws.addRow([0, ...Array.from({ length: N }, (_, i) => i + 1)]);
  const helperY = ws.addRow([0, ...sheet.kumulatifRencana.map((v) => round2(v))]);
  const helperR = ws.addRow([0, ...sheet.kumulatifRealisasi.map((v) => (v == null ? null : round2(v)))]);
  for (const hr of [helperX, helperY, helperR]) hr.hidden = true;
  const lastHelperCol = colLetter(N + 1); // A..(N+1) = origin + N minggu
  const hRange = (rowN: number) => `'${ws.name}'!$A$${rowN}:$${lastHelperCol}$${rowN}`;

  // Anchor OVERLAY transparan TEPAT di atas blok kolom minggu (kolom D..lastCol) ×
  // baris kategori (firstCatRow..lastCatRow) → kurva-S menelusuri kolom minggu.
  const firstCatRow = weekRow.number + 1;
  const lastCatRow = firstCatRow + sheet.categories.length - 1;
  return {
    sheetName: ws.name,
    xMax: N,
    series: [
      { name: "Rencana", xRef: hRange(helperX.number), yRef: hRange(helperY.number), color: "2563EB" },
      { name: "Realisasi", xRef: hRange(helperX.number), yRef: hRange(helperR.number), color: "16A34A" },
    ],
    anchor: { fromCol: FIRST - 1, fromRow: firstCatRow - 1, toCol: lastCol, toRow: lastCatRow },
  } satisfies LineChartSpec;
}

/**
 * Time Schedule (Kurva-S) berdiri sendiri sebagai .xlsx — satu sheet tabel
 * kategori × minggu (bobot) + kumulatif rencana/realisasi + GRAFIK NATIVE Excel.
 * Format menyerupai time schedule sipil (contoh TS vendor).
 */
export async function buildJadwalXlsx(r: PeriodReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.created = new Date();
  const chartSpec = await addKurvaSheet(wb, r, { sheetName: "Time Schedule" });
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  try {
    return await addLineChartToXlsx(buf, chartSpec);
  } catch {
    return buf;
  }
}

export async function buildPeriodReportXlsx(r: PeriodReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.created = new Date();
  const chartSpec = await addKurvaSheet(wb, r);
  const ws = wb.addWorksheet("Laporan", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  const judul = r.kind === "mingguan" ? "LAPORAN MINGGUAN PEKERJAAN" : "LAPORAN BULANAN PEKERJAAN";
  const ke = r.kind === "mingguan" ? `Minggu Ke-${r.n}` : `Bulan Ke-${r.n}`;
  const h = r.header;

  const title = (text: string, bold = true, size = 12) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, COLUMNS.length);
    row.getCell(1).font = { bold, size };
    row.getCell(1).alignment = { horizontal: "center" };
  };
  title(judul);
  title(ke, true, 11);
  title(`Periode ${formatTanggal(h.periodeStart, "d MMMM yyyy")} s/d ${formatTanggal(h.periodeEnd, "d MMMM yyyy")}`, false, 10);
  ws.addRow([]);

  // Blok identitas: label (merge A:B, kolom "No"+"Uraian" — lebar, tak terpotong)
  // + nilai (merge C:H) sama-sama rata kiri, jadi nilai menempel ke labelnya.
  const kv = (k: string, v: string | number, numFmt?: string) => {
    const row = ws.addRow([]);
    const label = row.getCell(1);
    label.value = k;
    label.font = { bold: true, size: 9 };
    label.alignment = { horizontal: "left", vertical: "middle" };
    ws.mergeCells(row.number, 1, row.number, 2);
    const value = row.getCell(3);
    value.value = v;
    value.font = { size: 9 };
    value.alignment = { horizontal: "left", vertical: "middle" };
    if (numFmt) value.numFmt = numFmt;
    ws.mergeCells(row.number, 3, row.number, 8);
    row.height = 15;
  };
  kv("Paket Pekerjaan", h.packageName);
  kv("Lokasi", `${h.locationName} — ${h.village}, ${h.regency}, ${h.province}`);
  kv("Nomor Kontrak", h.contractNumber);
  kv("Kontraktor Pelaksana", h.vendorName);
  kv("Nilai Fisik Lokasi", `Rp ${new Intl.NumberFormat("id-ID").format(Number(h.locationValue))}`);
  kv("Masa Pelaksanaan", `${h.masaPelaksanaanHari} Hari Kalender`);
  kv("Tahun Anggaran", String(h.tahunAnggaran));
  kv("Rencana s/d periode (%)", Number(r.planPct.toFixed(2)), "0.00");
  kv("Realisasi s/d periode (%)", Number(r.actualPct.toFixed(2)), "0.00");
  kv("Deviasi (%)", Number(r.deviationPct.toFixed(2)), "0.00");
  ws.addRow([]);

  // Header tabel.
  const head = ws.addRow(COLUMNS.map((c) => c.header));
  head.eachCell((cell) => {
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });

  const numericCols = [3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const styleDataRow = (row: ExcelJS.Row, opts?: { bold?: boolean; fill?: string }) => {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > COLUMNS.length) return;
      cell.border = {
        top: { style: "hair" },
        bottom: { style: "hair" },
        left: { style: "hair" },
        right: { style: "hair" },
      };
      if (opts?.bold) cell.font = { bold: true, size: 9 };
      else cell.font = { size: 9 };
      if (opts?.fill) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
      }
      if (numericCols.includes(col)) {
        cell.alignment = { horizontal: "right" };
        cell.numFmt = col === 5 ? RUPIAH_FMT : NUM_FMT;
      }
      if (col === 4) cell.alignment = { horizontal: "center" };
    });
  };

  for (const cat of r.categories) {
    const catRow = ws.addRow([cat.code, cat.name, null, null, null, cat.subtotalBobot]);
    styleDataRow(catRow, { bold: true, fill: "FFF1F5F9" });
    for (const it of cat.rows) {
      const row = ws.addRow([
        it.no,
        it.name,
        it.volK,
        it.unit,
        it.hargaSatuan,
        it.bobot,
        it.volLalu,
        it.prestasiLalu,
        it.volIni,
        it.prestasiIni,
        it.volSd,
        it.prestasiSd,
        it.bobotSd,
        it.sisaVol,
        it.sisaPrestasi,
      ]);
      styleDataRow(row);
    }
    const subRow = ws.addRow([
      null,
      `Subtotal ${cat.name}`,
      null,
      null,
      null,
      cat.subtotalBobot,
      null,
      cat.subtotalBobotLalu,
      null,
      cat.subtotalBobotIni,
      null,
      null,
      cat.subtotalBobotSd,
      null,
      null,
    ]);
    styleDataRow(subRow, { bold: true });
  }

  const totalBobot = r.categories.reduce((s, c) => s + c.subtotalBobot, 0);
  const totalRow = ws.addRow([
    null,
    "JUMLAH",
    null,
    null,
    null,
    totalBobot,
    null,
    r.totals.bobotLalu,
    null,
    r.totals.bobotIni,
    null,
    null,
    r.totals.bobotSd,
    null,
    null,
  ]);
  styleDataRow(totalRow, { bold: true, fill: "FFE2E8F0" });

  // Ringkasan sumber daya + kendala.
  ws.addRow([]);
  const section = (text: string) => {
    const row = ws.addRow([text]);
    row.getCell(1).font = { bold: true, size: 10 };
    ws.mergeCells(row.number, 1, row.number, 8);
  };
  section("Tenaga Kerja (orang-hari, agregat periode)");
  for (const t of r.tenaga) kv(t.label, t.count);
  section("Material Masuk (agregat periode)");
  for (const m of r.material) kv(m.name, `${m.qty}${m.unit ? ` ${m.unit}` : ""}`);
  section("Peralatan (unit-hari, agregat periode)");
  for (const a of r.alat) kv(a.name, a.count);
  section("Cuaca");
  kv("Ringkasan", r.cuacaRingkas);
  section("Kendala");
  if (r.kendala.length === 0) {
    kv("—", "Tidak ada kendala tercatat pada periode ini");
  } else {
    for (const k of r.kendala) kv(formatTanggal(k.createdAt), `${k.title} (${k.severity}, ${k.status})`);
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  // Sisipkan grafik kurva-S NATIVE ke sheet "Kurva S" (exceljs tak bisa; kita
  // pasca-proses XML chart OOXML). Bila gagal, kembalikan workbook tanpa chart.
  try {
    return await addLineChartToXlsx(buf, chartSpec);
  } catch {
    return buf;
  }
}
