import "server-only";
import { getPeriodReport, WORKER_ROLE_LABEL, type PeriodKind, type PeriodReport } from "@/lib/periodic-report";
import { getBranding } from "@/lib/branding";
import { ISSUE_SEVERITY_LABEL } from "@/lib/daily-report/constants";
import { formatRupiahShort, formatTanggal, formatTanggalWaktu } from "@/lib/format";
import {
  CONTENT_WIDTH,
  PAGE_MARGIN,
  PDF_COLORS,
  PDF_FONT,
  createA4Doc,
  detailBox,
  docToBuffer,
  paragraph,
  reportHeader,
  sectionHeading,
  stampFooters,
} from "@/lib/pdf/document";
import { kpiRow, table, type Kpi, type PdfColumn } from "@/lib/pdf/table";

/** Laporan Mingguan/Bulanan → PDF ringkas profesional (untuk lapor ke atasan via WA). DECISIONS 126. */

export type PeriodikPdfResult = { buffer: Buffer };

const pct = (n: number) => `${n.toFixed(2)}%`;

export async function buildPeriodikRingkasPdf(r: PeriodReport, appName: string, context: string): Promise<Buffer> {
  const kindLabel = r.kind === "mingguan" ? "Mingguan" : "Bulanan";
  const periodeLabel = r.kind === "mingguan" ? `Minggu ke-${r.n}` : `Bulan ke-${r.n}`;
  const doc = createA4Doc({ title: `Laporan ${kindLabel} — ${r.header.locationName}` });

  reportHeader(doc, appName, context, `Laporan ${kindLabel}`);

  doc.font(PDF_FONT.bold).fontSize(16).fillColor(PDF_COLORS.ink).text(r.header.locationName, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc
    .font(PDF_FONT.regular)
    .fontSize(9.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(
      `${periodeLabel}  ·  ${formatTanggal(r.header.periodeStart)} – ${formatTanggal(r.header.periodeEnd)}`,
      PAGE_MARGIN,
      doc.y + 1,
      { width: CONTENT_WIDTH },
    );
  doc.y += 8;

  detailBox(doc, [
    ["Lokasi", `${r.header.locationName} (${r.header.regency}, ${r.header.province})`],
    ["Paket", r.header.packageName],
    ["Kontrak", r.header.contractNumber || "–"],
    ["Penyedia", r.header.vendorName || "–"],
    ["Periode", `${formatTanggal(r.header.periodeStart)} – ${formatTanggal(r.header.periodeEnd)} (${periodeLabel})`],
    ["Nilai fisik lokasi", formatRupiahShort(r.header.locationValue)],
    ["Tahun anggaran", String(r.header.tahunAnggaran)],
  ]);

  // KPI utama: rencana / realisasi / deviasi.
  const devTone: Kpi["tone"] = r.deviationPct < -0.05 ? "danger" : r.deviationPct > 0.05 ? "success" : "default";
  const devSign = r.deviationPct > 0 ? "+" : "";
  kpiRow(
    doc,
    [
      { label: "Rencana s/d", value: pct(r.planPct) },
      { label: "Realisasi s/d", value: pct(r.actualPct), tone: r.actualPct >= r.planPct ? "success" : "warning" },
      { label: "Deviasi", value: `${devSign}${pct(r.deviationPct)}`, tone: devTone },
    ],
    CONTENT_WIDTH,
  );
  paragraph(
    doc,
    r.deviationPct < -0.05
      ? "Realisasi tertinggal dari rencana — perlu percepatan."
      : r.deviationPct > 0.05
        ? "Realisasi lebih cepat dari rencana."
        : "Realisasi sesuai rencana.",
  );

  // Progres per kategori.
  sectionHeading(doc, "Progres per Kategori Pekerjaan");
  const cols: PdfColumn[] = [
    { header: "Kategori Pekerjaan", width: 214 },
    { header: "Bobot %", width: 70, align: "right" },
    { header: `Real. ${r.kind === "mingguan" ? "minggu" : "bulan"} ini %`, width: 100, align: "right" },
    { header: "Real. s/d %", width: 115, align: "right" },
  ];
  const rows = r.categories.map((c) => [
    c.name,
    pct(c.subtotalBobot),
    pct(c.subtotalBobotIni),
    pct(c.subtotalBobotSd),
  ]);
  rows.push(["TOTAL", pct(100), pct(r.totals.bobotIni), pct(r.totals.bobotSd)]);
  table(doc, cols, rows);

  // Sumber daya.
  const tenaga = r.tenaga.filter((t) => t.count > 0);
  if (tenaga.length > 0) {
    sectionHeading(doc, "Tenaga Kerja (rata-rata periode)");
    paragraph(doc, tenaga.map((t) => `${WORKER_ROLE_LABEL[t.role] ?? t.label}: ${t.count}`).join("   ·   "));
  }
  const material = r.material.filter((m) => m.qty > 0);
  if (material.length > 0) {
    sectionHeading(doc, "Material");
    paragraph(doc, material.map((m) => `${m.name}: ${m.qty.toLocaleString("id-ID")}${m.unit ? ` ${m.unit}` : ""}`).join("   ·   "));
  }
  const alat = r.alat.filter((a) => a.count > 0);
  if (alat.length > 0) {
    sectionHeading(doc, "Peralatan");
    paragraph(doc, alat.map((a) => `${a.name}: ${a.count}`).join("   ·   "));
  }

  // Kendala.
  if (r.kendala.length > 0) {
    sectionHeading(doc, `Kendala (${r.kendala.length})`);
    const kcols: PdfColumn[] = [
      { header: "Kendala", width: 300 },
      { header: "Tingkat", width: 90, align: "center" },
      { header: "Status", width: 109, align: "center" },
    ];
    const krows = r.kendala.map((k) => [
      k.title,
      ISSUE_SEVERITY_LABEL[k.severity as keyof typeof ISSUE_SEVERITY_LABEL] ?? k.severity,
      String(k.status).replace(/_/g, " "),
    ]);
    table(doc, kcols, krows);
  }

  stampFooters(doc, `Dibuat otomatis via ${appName} · ${formatTanggalWaktu(new Date())}`);
  return docToBuffer(doc);
}

/** Muat data periodik + render PDF ringkas. Null bila tak tersedia. TANPA otorisasi (pemanggil gate). */
export async function renderPeriodikPdf(locationId: string, kind: PeriodKind, n: number): Promise<PeriodikPdfResult | null> {
  const [report, branding] = await Promise.all([getPeriodReport(locationId, kind, n), getBranding()]);
  if (!report) return null;
  const buffer = await buildPeriodikRingkasPdf(report, branding.appName, branding.projectContext);
  return { buffer };
}
