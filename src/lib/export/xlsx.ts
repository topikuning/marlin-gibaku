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

// Lebar kolom tabel rincian — header blanko KKP (3 baris, berkelompok):
// No | Uraian | Volume Kontrak | Satuan | Bobot |
// Realisasi Pekerjaan { Lalu / Ini / S-d × Volume, Prestasi, Bobot } |
// Bobot Rencana | Sisa Pekerjaan { Prestasi, Volume }.
const COL_WIDTHS = [5, 48, 12, 8, 9, 11, 9, 9, 11, 9, 9, 11, 9, 9, 11, 9, 11] as const;
const COL_COUNT = COL_WIDTHS.length; // 17

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Sheet-1 "Kurva S": tabel bobot kategori × minggu (increment) + baris prestasi
 * (rencana/realisasi kumulatif + deviasi) + GAMBAR grafik kurva-S. Angka identik
 * dgn tabel KKP & kurva PDF (satu sumber, buildKurvaSheet).
 */
type KurvaSheetResult = {
  chart: LineChartSpec;
  /**
   * Tautkan sel "Realisasi Prestasi %" minggu `week` (1-based) ke rumus Excel
   * (mis. total "Bobot Minggu ini" di sheet Laporan) — angka minggu aktif
   * TERTAUT ke rinciannya, bukan tempelan statis. Diabaikan bila minggu di luar
   * rentang ber-realisasi (menjaga kolom kosong tetap kosong, B7).
   */
  linkRealisasi: (week: number, formula: string) => void;
};

async function addKurvaSheet(
  wb: ExcelJS.Workbook,
  r: PeriodReport,
  opts?: { sheetName?: string },
): Promise<KurvaSheetResult> {
  const sheet = buildKurvaSheet({
    categories: r.kurvaSchedule,
    totalWeeks: r.totalWeeks,
    contractStart: r.header.contractStart,
    actualCum: r.scurve.actualPct,
    currentWeek: r.scurve.currentWeek,
    planCumOfficial: r.scurve.planPct,
  });
  const N = sheet.totalWeeks;
  const FIRST = 4; // A=No, B=Uraian, C=Bobot, D.. = minggu
  const lastCol = 3 + N;
  // KETERANGAN di kanan: 2 kolom sempit batang skala checkerboard (0–100%) + 1 kolom label.
  const scaleA = lastCol + 1;
  const scaleB = lastCol + 2;
  const ketLabel = lastCol + 3;
  const lastTableCol = ketLabel;
  const ws = wb.addWorksheet(opts?.sheetName ?? "Kurva S", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { width: 5 },
    { width: 40 },
    { width: 9 },
    ...Array.from({ length: N }, () => ({ width: 6 })),
    { width: 2.6 },
    { width: 2.6 },
    { width: 6 },
  ];

  const thin = { style: "thin" as const };
  const box = { top: thin, bottom: thin, left: thin, right: thin };

  const banner = (text: string, bold: boolean, size: number) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, lastTableCol);
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
  monthRow.getCell(scaleA).value = "KETERANGAN";
  ws.mergeCells(monthRow.number, scaleA, weekRow.number, ketLabel); // header KET 2 baris × 3 kolom
  for (const row of [monthRow, weekRow]) {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > lastTableCol) return;
      cell.font = { bold: true, size: 8 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      cell.border = box;
    });
  }

  // Baris kategori (bobot + increment mingguan).
  const catRowNums: number[] = [];
  const weekFirstL = colLetter(FIRST);
  const weekLastL = colLetter(lastCol);
  for (const cat of sheet.categories) {
    const row = ws.addRow([cat.code, cat.name, null, ...cat.weeklyShown.map((v) => (v > 0 ? v : null))]);
    // Kolom "Bobot (%)" = RUMUS Σ sebaran mingguan barisnya, bukan angka
    // tempelan: bobot kategori bisa ditelusuri ke minggu pembentuknya, dan
    // mengubah sel minggu di Excel langsung memperbarui bobotnya. Nilai cache =
    // bobot resmi kategori — `weeklyShown` sudah dialokasikan supaya Σ-nya
    // persis segitu (kkp-sheet.ts).
    row.getCell(3).value = {
      formula: `SUM(${weekFirstL}${row.number}:${weekLastL}${row.number})`,
      result: cat.bobotShown,
    };
    catRowNums.push(row.number);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > lastCol) return;
      cell.border = box;
      cell.font = { size: 8, bold: col === 2 };
      if (col === 1) cell.alignment = { horizontal: "center" };
      else if (col === 3) { cell.alignment = { horizontal: "center" }; cell.numFmt = "#,##0.00"; }
      else if (col >= FIRST) { cell.alignment = { horizontal: "right" }; cell.numFmt = "#,##0.000"; }
    });
  }

  // Baris prestasi (kumulatif rencana/realisasi + deviasi). RUMUS, bukan angka
  // statis, supaya edit tabel kategori/realisasi otomatis menjalar ke kumulatif → grafik.
  const colL = (i: number) => colLetter(FIRST + i); // kolom minggu ke-i (0-based): D, E, …
  // Minggu terakhir yang punya realisasi resmi — kolom sesudahnya SENGAJA
  // kosong, sama dengan layar & PDF (audit 2026-07-27, B7: Excel dulu menulis
  // kumulatif carry-forward + deviasi negatif besar untuk minggu depan yang di
  // layar kosong — satu dokumen, dua cerita).
  const cutoffIdx = (() => {
    let last = -1;
    for (let i = 0; i < N; i++) if (sheet.kumulatifRealisasi[i] != null) last = i;
    return last;
  })();
  let rencanaRow = 0;
  let kumRencanaRow = 0;
  let realisasiRow = 0;
  let kumRealisasiRow = 0;
  type Kind = "rencana" | "kumRencana" | "realisasi" | "kumRealisasi" | "deviasi";
  const prestasi: { label: string; arr: (number | null)[]; bold: boolean; kind: Kind }[] = [
    { label: "Rencana Prestasi %", arr: sheet.rencanaPerWeek, bold: false, kind: "rencana" },
    { label: "Kumulatif Rencana Prestasi %", arr: sheet.kumulatifRencana, bold: true, kind: "kumRencana" },
    { label: "Realisasi Prestasi %", arr: sheet.realisasiPerWeek, bold: false, kind: "realisasi" },
    { label: "Kumulatif Realisasi Prestasi %", arr: sheet.kumulatifRealisasi, bold: true, kind: "kumRealisasi" },
    { label: "Deviasi +/-", arr: sheet.deviasi, bold: true, kind: "deviasi" },
  ];
  for (const def of prestasi) {
    const row = ws.addRow([]);
    if (def.kind === "rencana") rencanaRow = row.number;
    else if (def.kind === "kumRencana") kumRencanaRow = row.number;
    else if (def.kind === "realisasi") realisasiRow = row.number;
    else if (def.kind === "kumRealisasi") kumRealisasiRow = row.number;
    row.getCell(1).value = def.label;
    ws.mergeCells(row.number, 1, row.number, 2); // label A:B — kolom C tetap kolom bobot
    row.getCell(1).alignment = { horizontal: "right" };
    row.getCell(1).font = { size: 8, bold: def.bold };
    row.getCell(1).border = box;
    // Total kolom bobot (baris kumulatif rencana) = RUMUS Σ bobot kategori,
    // sejajar dengan tampilan layar/PDF. Ikut hidup bila baris kategori diedit.
    const totalCell = row.getCell(3);
    if (def.kind === "kumRencana" && catRowNums.length > 0) {
      totalCell.value = {
        formula: `SUM(C${catRowNums[0]}:C${catRowNums[catRowNums.length - 1]})`,
        result: sheet.totalBobotShown,
      };
      totalCell.numFmt = "#,##0.00";
    }
    totalCell.alignment = { horizontal: "center" };
    totalCell.font = { size: 8, bold: def.bold };
    totalCell.border = box;
    for (let i = 0; i < N; i++) {
      const cell = row.getCell(FIRST + i);
      const val = def.arr[i] == null ? null : round2(def.arr[i] as number);
      if (def.kind === "rencana" || def.kind === "kumRencana") {
        // Rencana = kurva RESMI baseline (statik, bukan Σ rumus jadwal): sumber
        // yang sama dengan halaman-2 dan dashboard (B3). Jadwal kategori di
        // atasnya tinggal rincian — mengeditnya di Excel TIDAK menggeser kurva
        // resmi; perubahan rencana resmi lewat editor baseline / re-import
        // Time Schedule.
        cell.value = val;
      } else if (def.kind === "kumRealisasi") {
        // Rumus kumulatif hidup HANYA s/d minggu ber-realisasi; sesudahnya
        // kosong seperti layar/PDF (B7).
        if (i <= cutoffIdx) {
          const f = i === 0 ? `${colL(0)}${realisasiRow}` : `${colL(i - 1)}${kumRealisasiRow}+${colL(i)}${realisasiRow}`;
          cell.value = { formula: f, result: val ?? 0 };
        } else {
          cell.value = null;
        }
      } else if (def.kind === "deviasi") {
        if (i <= cutoffIdx) {
          cell.value = {
            formula: `${colL(i)}${kumRealisasiRow}-${colL(i)}${kumRencanaRow}`,
            result: round2((sheet.kumulatifRealisasi[i] ?? 0) - sheet.kumulatifRencana[i]),
          };
        } else {
          cell.value = null;
        }
      } else {
        // Realisasi per-minggu = nilai aktual dari aplikasi (sumber; bisa diedit manual).
        cell.value = val;
      }
      cell.numFmt = "#,##0.00";
      cell.alignment = { horizontal: "right" };
      cell.font = { size: 8, bold: def.bold };
      cell.border = box;
    }
    for (const kc of [scaleA, scaleB, ketLabel]) row.getCell(kc).border = box; // KET berpetak
  }

  // KETERANGAN = BATANG SKALA 0–100% kotak-kotak HITAM-PUTIH (checkerboard) sejajar
  // rentang vertikal kurva (baris kategori), + label 100/75/50/25/0 di kanan batang.
  const M = catRowNums.length;
  if (M > 0) {
    const fillC = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
    const BLACK = "FF000000";
    const WHITE = "FFFFFFFF";
    catRowNums.forEach((rowN, i) => {
      const row = ws.getRow(rowN);
      row.getCell(scaleA).fill = fillC(i % 2 === 0 ? BLACK : WHITE);
      row.getCell(scaleB).fill = fillC(i % 2 === 0 ? WHITE : BLACK);
      for (const kc of [scaleA, scaleB, ketLabel]) row.getCell(kc).border = box;
    });
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
      const cell = ws.getRow(rowN).getCell(ketLabel);
      cell.value = val;
      cell.numFmt = '0"%"';
      cell.font = { size: 8, bold: true, color: { argb: "FF0F172A" } };
      cell.alignment = { horizontal: "right", vertical: vAlign };
    }
  }

  // Data helper (baris TERSEMBUNYI) utk chart scatter: titik origin (X=0, Y=0%) +
  // kumulatif per akhir-minggu (X=1..N). Scatter dipilih (bukan line/kategori) supaya
  // kurva MULAI dari 0% di kiri-bawah & X menembus tepi kolom minggu (w/N). `plotVisOnly=0`
  // di chartXml → baris tersembunyi ini tetap diplot.
  const helperX = ws.addRow([0, ...Array.from({ length: N }, (_, i) => i + 1)]);
  // Sumber Y grafik = RUMUS tertaut ke baris kumulatif yang terlihat (bukan angka
  // statis). Jadi begitu tabel diedit di Excel, grafik ikut ter-update. Sel A tetap
  // 0 (titik origin agar kurva mulai dari 0%).
  const helperY = ws.addRow([]);
  helperY.getCell(1).value = 0;
  for (let i = 0; i < N; i++) {
    helperY.getCell(2 + i).value = { formula: `${colL(i)}${kumRencanaRow}`, result: round2(sheet.kumulatifRencana[i]) };
  }
  const helperR = ws.addRow([]);
  helperR.getCell(1).value = 0;
  for (let i = 0; i < N; i++) {
    // Sumber realisasi grafik mengikuti baris "Kumulatif Realisasi" — yang kini
    // berhenti di minggu ber-realisasi terakhir (B7). Garis realisasi di grafik
    // pun berhenti di titik yang sama dengan layar/PDF.
    if (i <= cutoffIdx) {
      helperR.getCell(2 + i).value = {
        formula: `${colL(i)}${kumRealisasiRow}`,
        result: round2(sheet.kumulatifRealisasi[i] ?? 0),
      };
    } else {
      helperR.getCell(2 + i).value = null;
    }
  }
  for (const hr of [helperX, helperY, helperR]) hr.hidden = true;
  const lastHelperCol = colLetter(N + 1); // A..(N+1) = origin + N minggu
  const hRange = (rowN: number) => `'${ws.name}'!$A$${rowN}:$${lastHelperCol}$${rowN}`;

  // Anchor OVERLAY transparan TEPAT di atas blok kolom minggu (kolom D..lastCol) ×
  // baris kategori (firstCatRow..lastCatRow) → kurva-S menelusuri kolom minggu.
  const firstCatRow = weekRow.number + 1;
  const lastCatRow = firstCatRow + sheet.categories.length - 1;
  const chart: LineChartSpec = {
    sheetName: ws.name,
    xMax: N,
    series: [
      { name: "Rencana", xRef: hRange(helperX.number), yRef: hRange(helperY.number), color: "2563EB" },
      { name: "Realisasi", xRef: hRange(helperX.number), yRef: hRange(helperR.number), color: "16A34A" },
    ],
    anchor: { fromCol: FIRST - 1, fromRow: firstCatRow - 1, toCol: lastCol, toRow: lastCatRow },
  };
  return {
    chart,
    linkRealisasi: (week, formula) => {
      if (week < 1 || week > N || week - 1 > cutoffIdx) return;
      const cell = ws.getRow(realisasiRow).getCell(FIRST + week - 1);
      const cur = cell.value;
      cell.value = { formula, result: typeof cur === "number" ? cur : 0 };
    },
  };
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
  const { chart } = await addKurvaSheet(wb, r, { sheetName: "Time Schedule" });
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  try {
    return await addLineChartToXlsx(buf, chart);
  } catch {
    return buf;
  }
}

export async function buildPeriodReportXlsx(r: PeriodReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.created = new Date();
  const kurva = await addKurvaSheet(wb, r);
  const ws = wb.addWorksheet("Laporan", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = COL_WIDTHS.map((w) => ({ width: w }));
  const periodeLabel = r.kind === "mingguan" ? "Minggu" : "Bulan";

  const judul = r.kind === "mingguan" ? "LAPORAN MINGGUAN PEKERJAAN" : "LAPORAN BULANAN PEKERJAAN";
  const ke = r.kind === "mingguan" ? `Minggu Ke-${r.n}` : `Bulan Ke-${r.n}`;
  const h = r.header;

  const title = (text: string, bold = true, size = 12) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, COL_COUNT);
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

  // Header tabel — 3 baris berkelompok, mengikuti blanko KKP.
  const thinBox = {
    top: { style: "thin" as const },
    bottom: { style: "thin" as const },
    left: { style: "thin" as const },
    right: { style: "thin" as const },
  };
  const h1 = ws.addRow([]);
  const h2 = ws.addRow([]);
  const h3 = ws.addRow([]);
  const setHead = (row: ExcelJS.Row, col: number, text: string) => {
    row.getCell(col).value = text;
  };
  setHead(h1, 1, "No");
  setHead(h1, 2, "Uraian Pekerjaan");
  setHead(h1, 3, "Volume Kontrak");
  setHead(h1, 4, "Satuan");
  setHead(h1, 5, "Bobot");
  setHead(h1, 6, "Realisasi Pekerjaan");
  setHead(h1, 15, "Bobot Rencana");
  setHead(h1, 16, "Sisa Pekerjaan");
  setHead(h2, 6, `${periodeLabel} Lalu`);
  setHead(h2, 9, `${periodeLabel} ini`);
  setHead(h2, 12, `S/d ${periodeLabel} ini`);
  setHead(h2, 16, `S/d ${periodeLabel} ini`);
  for (const base of [6, 9, 12]) {
    setHead(h3, base, "Volume");
    setHead(h3, base + 1, "Prestasi");
    setHead(h3, base + 2, "Bobot");
  }
  setHead(h3, 16, "Prestasi");
  setHead(h3, 17, "Volume");
  for (const col of [1, 2, 3, 4, 5, 15]) ws.mergeCells(h1.number, col, h3.number, col);
  ws.mergeCells(h1.number, 6, h1.number, 14); // "Realisasi Pekerjaan"
  ws.mergeCells(h1.number, 16, h1.number, 17); // "Sisa Pekerjaan"
  ws.mergeCells(h2.number, 6, h2.number, 8);
  ws.mergeCells(h2.number, 9, h2.number, 11);
  ws.mergeCells(h2.number, 12, h2.number, 14);
  ws.mergeCells(h2.number, 16, h2.number, 17);
  for (const row of [h1, h2, h3]) {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > COL_COUNT) return;
      cell.font = { bold: true, size: 9 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      cell.border = thinBox;
    });
  }

  const numericCols = [3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const styleDataRow = (row: ExcelJS.Row, opts?: { bold?: boolean; fill?: string }) => {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > COL_COUNT) return;
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
        cell.numFmt = NUM_FMT;
      }
      if (col === 4) cell.alignment = { horizontal: "center" };
    });
  };

  // Kolom bobot yang MENJUMLAH: E=Bobot, H=Bobot Lalu, K=Bobot Ini,
  // N=Bobot S/d, O=Bobot Rencana. Subtotal kategori = rumus SUM atas baris
  // item; JUMLAH = penjumlahan sel subtotal — angka agregat TERTAUT ke rincian
  // (kebiasaan pemeriksa KKP menelusuri link), nilai cache = angka resmi.
  const SUM_COLS = [
    { col: 5, sub: (c: (typeof r.categories)[number]) => c.subtotalBobot, total: () => r.categories.reduce((s, c) => s + c.subtotalBobot, 0) },
    { col: 8, sub: (c: (typeof r.categories)[number]) => c.subtotalBobotLalu, total: () => r.totals.bobotLalu },
    { col: 11, sub: (c: (typeof r.categories)[number]) => c.subtotalBobotIni, total: () => r.totals.bobotIni },
    { col: 14, sub: (c: (typeof r.categories)[number]) => c.subtotalBobotSd, total: () => r.totals.bobotSd },
    { col: 15, sub: (c: (typeof r.categories)[number]) => c.subtotalBobotRencana, total: () => r.totals.bobotRencana },
  ] as const;
  const subRowNums: number[] = [];

  for (const cat of r.categories) {
    const catRow = ws.addRow([cat.code, cat.name, null, null, cat.subtotalBobot]);
    styleDataRow(catRow, { bold: true, fill: "FFF1F5F9" });
    let firstItemRow = 0;
    let lastItemRow = 0;
    for (const it of cat.rows) {
      const row = ws.addRow([
        it.no,
        it.name,
        it.volK,
        it.unit,
        it.bobot,
        it.volLalu,
        it.prestasiLalu,
        it.bobotLalu,
        it.volIni,
        it.prestasiIni,
        it.bobotIni,
        it.volSd,
        it.prestasiSd,
        it.bobotSd,
        it.bobotRencana,
        it.sisaPrestasi,
        it.sisaVol,
      ]);
      if (!firstItemRow) firstItemRow = row.number;
      lastItemRow = row.number;
      styleDataRow(row);
    }
    const subRow = ws.addRow([null, `Subtotal ${cat.name}`]);
    for (const { col, sub } of SUM_COLS) {
      const L = colLetter(col);
      subRow.getCell(col).value = firstItemRow
        ? { formula: `SUM(${L}${firstItemRow}:${L}${lastItemRow})`, result: sub(cat) }
        : sub(cat);
    }
    subRowNums.push(subRow.number);
    styleDataRow(subRow, { bold: true });
  }

  const totalRow = ws.addRow([null, "JUMLAH"]);
  for (const { col, total } of SUM_COLS) {
    const L = colLetter(col);
    totalRow.getCell(col).value =
      subRowNums.length > 0
        ? { formula: subRowNums.map((n2) => `${L}${n2}`).join("+"), result: total() }
        : total();
  }
  styleDataRow(totalRow, { bold: true, fill: "FFE2E8F0" });

  // Baris "Realisasi Prestasi %" minggu laporan di sheet Kurva S TERTAUT ke
  // total "Bobot Minggu ini" (JUMLAH kolom K) di sheet ini — bukan angka
  // tempelan. Rumus kumulatif & grafik sudah membaca baris itu, jadi tautan
  // menjalar sampai kurva. Hanya utk laporan mingguan (bulanan mencakup >1
  // kolom minggu — tak bisa dipetakan ke satu sel).
  if (r.kind === "mingguan") {
    kurva.linkRealisasi(r.n, `Laporan!${colLetter(11)}${totalRow.number}`);
  }

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
    return await addLineChartToXlsx(buf, kurva.chart);
  } catch {
    return buf;
  }
}
