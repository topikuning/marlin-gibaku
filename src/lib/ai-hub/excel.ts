import ExcelJS from "exceljs";
import {
  MAKS_PRIORITAS,
  analisisPendukung,
  buildExecutiveBrief,
  renderAiReportExcelRows,
  type AiReportContent,
} from "./render";

/**
 * Pembangun workbook artefak laporan AI — MURNI (tanpa DB, tanpa request)
 * supaya paritas kanal bisa diuji unit, bukan cuma dipercaya. Route API hanya
 * mengurus izin, audit, dan header unduhan. DECISIONS 133/453/454.
 *
 * Lembar pertama = ringkasan eksekutif (yang dibaca pimpinan saat file dibuka);
 * tabel mentah baru di lembar kedua.
 */

const BIRU = "FF0F3D5E";

/** Judul bagian: satu baris tebal berwarna, tanpa mengunci nomor barisnya. */
function judulBagian(ws: ExcelJS.Worksheet, teks: string): void {
  ws.addRow([teks]);
  ws.getRow(ws.rowCount).font = { bold: true, color: { argb: BIRU } };
}

function kepalaTabel(ws: ExcelJS.Worksheet, kolom: string[]): void {
  ws.addRow(kolom);
  ws.getRow(ws.rowCount).font = { bold: true };
}

export function buildAiReportWorkbook(content: AiReportContent): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const brief = buildExecutiveBrief(content);
  const o = content.official;

  const summary = wb.addWorksheet("Ringkasan Eksekutif");
  // Lebar kolom DITETAPKAN SEBELUM baris ditambahkan: menugaskan `columns`
  // setelah data masuk adalah jalur yang menulis ulang definisi kolom.
  summary.columns = [{ width: 27 }, { width: 34 }, { width: 55 }, { width: 44 }];

  summary.mergeCells("A1:D1");
  summary.getCell("A1").value = content.report.title;
  summary.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  summary.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: BIRU } };
  summary.getCell("A1").alignment = { vertical: "middle" };
  summary.getRow(1).height = 34;

  summary.addRow(["Status", brief.statusLabel, "Periode", `${o.periodStart} s/d ${o.periodEnd}`]);
  summary.addRow(["Dasar keyakinan", brief.evidenceLabel, "Data terakhir berubah", o.dataAsOf ?? "–"]);

  if (brief.dataWarning) {
    summary.addRow([]);
    judulBagian(summary, "JANGAN MENILAI KINERJA FISIK DULU");
    summary.addRow([brief.dataWarning]);
    summary.mergeCells(`A${summary.rowCount}:D${summary.rowCount}`);
  }

  summary.addRow([]);
  judulBagian(summary, "KESIMPULAN 30 DETIK");
  summary.addRow([brief.headline]);
  const barisHeadline = summary.rowCount;
  summary.mergeCells(`A${barisHeadline}:D${barisHeadline}`);
  summary.getRow(barisHeadline).height = 48;

  summary.addRow([]);
  judulBagian(summary, "INDIKATOR UTAMA");
  kepalaTabel(summary, ["Indikator", "Nilai", "Keterangan"]);
  for (const kpi of brief.kpis) summary.addRow([kpi.label, kpi.value, kpi.note]);

  summary.addRow([]);
  judulBagian(summary, `${MAKS_PRIORITAS} PRIORITAS UTAMA`);
  kepalaTabel(summary, ["Lokasi", "Paket / Provinsi", "Mengapa prioritas", "Angka kunci"]);
  for (const priority of brief.priorities) {
    summary.addRow([
      priority.name,
      `${priority.packageName} / ${priority.province}`,
      priority.reason,
      `Realisasi ${priority.actualPct.toFixed(1)}% | Rencana ${priority.planPct.toFixed(1)}% | Laporan ${priority.finalReports}/${priority.expectedReports}`,
    ]);
  }
  if (o.rows.length > brief.priorities.length) {
    summary.addRow([`${o.rows.length - brief.priorities.length} lokasi lain ada di lembar Angka Resmi.`]);
  }

  summary.addRow([]);
  judulBagian(summary, "KEPUTUSAN YANG DIMINTA");
  if (brief.decisions.length) {
    kepalaTabel(summary, ["Keputusan", "Alasan / konsekuensi bila ditunda"]);
    for (const [index, decision] of brief.decisions.entries()) {
      summary.addRow([`${index + 1}. ${decision.title}`, decision.reason]);
    }
    // Yang disembunyikan DISEBUT jumlahnya — "tidak muncul" tidak boleh
    // terbaca sebagai "tidak ada".
    if (brief.decisionsHidden > 0) {
      summary.addRow([`${brief.decisionsHidden} usulan lain tidak ditampilkan – buka editor laporan untuk melihatnya.`]);
    }
  } else {
    summary.addRow(["Tidak ada keputusan yang diminta pada periode ini."]);
  }

  summary.eachRow((row) => {
    row.alignment = { ...row.alignment, wrapText: true, vertical: "top" };
  });

  const ws = wb.addWorksheet("Angka Resmi");
  ws.addRows(renderAiReportExcelRows(content));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => {
    c.width = 18;
  });

  const ws2 = wb.addWorksheet("Analisis Pendukung");
  ws2.getColumn(1).width = 110;
  ws2.addRow(["Judul", content.report.title]);
  ws2.addRow(["Status keseluruhan", brief.statusLabel]);
  ws2.addRow(["Dasar keyakinan", brief.evidenceLabel]);
  ws2.addRow([]);
  ws2.addRow(["Ringkasan eksekutif"]);
  ws2.addRow([content.report.executiveSummary]);
  ws2.addRow([]);
  // Dokumen lengkap: SELURUH bagian ikut, tidak dipangkas seperti WhatsApp.
  const analisis = analisisPendukung(content, content.report.sections.length);
  for (const s of analisis.items) {
    ws2.addRow([s.heading]);
    ws2.addRow([s.body]);
    ws2.addRow([]);
  }
  if (content.report.limitations.length) {
    ws2.addRow(["Keterbatasan analisis"]);
    for (const l of content.report.limitations) ws2.addRow([l]);
  }
  ws2.eachRow((r) => {
    r.alignment = { wrapText: true, vertical: "top" };
  });

  return wb;
}
