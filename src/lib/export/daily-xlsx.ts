import "server-only";
import ExcelJS from "exceljs";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { WORKER_ROLE_LABEL, WORKER_ROLE_ORDER } from "@/lib/daily-report/constants";

/**
 * Export Laporan Harian KKP ke .xlsx (satu sheet) — identitas → tabel kemajuan
 * item → tenaga kerja → material → peralatan → cuaca/jam kerja/catatan.
 * Dipakai untuk unduhan & kiriman WhatsApp. Angka konsisten dgn laporan periodik.
 */

const NUM2 = "#,##0.00";
const NUM3 = "#,##0.000";

export async function buildDailyReportXlsx(d: KkpDailyData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  const ws = wb.addWorksheet("Laporan Harian", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const title = (row: number, text: string) => {
    const c = ws.getCell(`A${row}`);
    c.value = text;
    c.font = { bold: true, size: 13 };
  };
  const kv = (row: number, label: string, value: string) => {
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.getCell(`C${row}`).value = value;
  };

  // ── Kop ──
  title(1, "LAPORAN HARIAN");
  title(2, "Kampung Nelayan Merah Putih (KNMP)");
  kv(4, "Lokasi", d.locationName);
  kv(5, "Kabupaten/Kota", `${d.regency}, ${d.province}`);
  kv(6, "Hari / Tanggal", `${d.hari}, ${d.tanggalFull}`);
  kv(7, "Minggu ke", d.weekNo != null ? String(d.weekNo) : "-");
  kv(8, "Tahun Anggaran", String(d.tahunAnggaran));
  kv(9, "Status", d.isFinal ? "FINAL" : "PRATINJAU (belum final)");

  // ── Tabel kemajuan pekerjaan ──
  let row = 11;
  ws.getCell(`A${row}`).value = "KEMAJUAN PEKERJAAN";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  row++;

  const headers = ["No", "Uraian Pekerjaan", "Sat.", "Vol Kontrak", "Vol s/d Lalu", "Vol Hari Ini", "Vol s/d Ini", "% s/d Ini"];
  const widths = [5, 46, 8, 13, 13, 13, 13, 10];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const headRow = ws.getRow(row);
  headers.forEach((h, i) => {
    const c = headRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.alignment = { horizontal: i === 1 ? "left" : "center", vertical: "middle", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
    c.border = border;
  });
  row++;

  let no = 0;
  for (const it of d.items) {
    no++;
    const r = ws.getRow(row);
    const cells: (string | number | null)[] = [
      no,
      `${it.code ? it.code + "  " : ""}${it.name}`,
      it.unit ?? "",
      it.volumeContract,
      it.volumeBefore,
      it.volumeToday,
      it.volumeCumulative,
      it.pctCumulative,
    ];
    cells.forEach((v, i) => {
      const c = r.getCell(i + 1);
      c.value = v;
      c.border = border;
      if (i >= 3 && i <= 6) c.numFmt = NUM3;
      if (i === 7) c.numFmt = NUM2;
      c.alignment = { horizontal: i === 1 ? "left" : i === 0 ? "center" : "right", vertical: "top", wrapText: i === 1 };
    });
    row++;
  }
  if (d.items.length === 0) {
    ws.getCell(`A${row}`).value = "Tidak ada progres pekerjaan pada hari ini.";
    row++;
  }

  // ── Tenaga kerja ──
  row += 1;
  ws.getCell(`A${row}`).value = "TENAGA KERJA";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  row++;
  for (const wr of WORKER_ROLE_ORDER) {
    const n = d.workerMap[wr] ?? 0;
    if (!n) continue;
    ws.getCell(`B${row}`).value = WORKER_ROLE_LABEL[wr];
    ws.getCell(`D${row}`).value = n;
    ws.getCell(`D${row}`).numFmt = "#,##0";
    ws.getCell(`E${row}`).value = "orang";
    row++;
  }
  ws.getCell(`B${row}`).value = "Total tenaga kerja";
  ws.getCell(`B${row}`).font = { bold: true };
  ws.getCell(`D${row}`).value = d.totalWorkers;
  ws.getCell(`D${row}`).font = { bold: true };
  ws.getCell(`E${row}`).value = "orang";
  row += 2;

  // ── Material ──
  ws.getCell(`A${row}`).value = "MATERIAL";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  row++;
  if (d.materials.length === 0) {
    ws.getCell(`B${row}`).value = "—";
    row++;
  } else {
    for (const m of d.materials) {
      ws.getCell(`B${row}`).value = m.name;
      ws.getCell(`D${row}`).value = m.qty;
      if (m.qty != null) ws.getCell(`D${row}`).numFmt = NUM3;
      ws.getCell(`E${row}`).value = m.unit ?? "";
      row++;
    }
  }
  row += 1;

  // ── Peralatan ──
  ws.getCell(`A${row}`).value = "PERALATAN";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  row++;
  if (d.equipment.length === 0) {
    ws.getCell(`B${row}`).value = "—";
    row++;
  } else {
    for (const e of d.equipment) {
      ws.getCell(`B${row}`).value = e.name;
      ws.getCell(`D${row}`).value = e.count;
      ws.getCell(`D${row}`).numFmt = "#,##0";
      ws.getCell(`E${row}`).value = "unit";
      row++;
    }
  }
  row += 1;

  // ── Cuaca / jam kerja / catatan ──
  ws.getCell(`A${row}`).value = "KONDISI & CATATAN";
  ws.getCell(`A${row}`).font = { bold: true, size: 12 };
  row++;
  kv(row++, "Cuaca", d.activeWeather ?? "-");
  kv(row++, "Jam kerja", d.workStart && d.workEnd ? `${d.workStart} – ${d.workEnd}` : "-");
  ws.getCell(`A${row}`).value = "Catatan";
  ws.getCell(`A${row}`).font = { bold: true };
  ws.getCell(`C${row}`).value = d.notes ?? "-";
  ws.getCell(`C${row}`).alignment = { wrapText: true, vertical: "top" };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
