import "server-only";
import ExcelJS from "exceljs";
import type { PeriodReport } from "@/lib/periodic-report";
import { formatTanggal } from "@/lib/format";

/**
 * Export laporan periodik ke .xlsx (exceljs, server-side — BUKAN AG Grid export).
 * Satu sheet "Laporan": header identitas → tabel item per kategori → totals.
 * Format angka #,##0.00 agar konsisten dibuka di Excel Indonesia.
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

export async function buildPeriodReportXlsx(r: PeriodReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.created = new Date();
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

  const kv = (k: string, v: string | number) => {
    const row = ws.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    ws.mergeCells(row.number, 2, row.number, 8);
  };
  kv("Paket Pekerjaan", h.packageName);
  kv("Lokasi", `${h.locationName} — ${h.village}, ${h.regency}, ${h.province}`);
  kv("Nomor Kontrak", h.contractNumber);
  kv("Kontraktor Pelaksana", h.vendorName);
  kv("Nilai Fisik Lokasi", `Rp ${new Intl.NumberFormat("id-ID").format(Number(h.locationValue))}`);
  kv("Masa Pelaksanaan", `${h.masaPelaksanaanHari} Hari Kalender`);
  kv("Tahun Anggaran", h.tahunAnggaran);
  kv("Rencana s/d periode (%)", Number(r.planPct.toFixed(2)));
  kv("Realisasi s/d periode (%)", Number(r.actualPct.toFixed(2)));
  kv("Deviasi (%)", Number(r.deviationPct.toFixed(2)));
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

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
