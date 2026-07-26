import "server-only";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { getKkpDailyData } from "@/lib/daily-report/queries";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { WORKER_ROLE_LABEL } from "@/lib/periodic-report";
import { formatTanggalWaktu } from "@/lib/format";
import type { WorkerRole } from "@/generated/prisma/enums";
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
import { kpiRow, table, type PdfColumn } from "@/lib/pdf/table";

/** Laporan Harian → PDF ringkas profesional (untuk lapor ke atasan via WA). DECISIONS 126. */

export type HarianPdfResult = { buffer: Buffer; locationId: string };

const nf = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

export async function buildHarianRingkasPdf(d: KkpDailyData, appName: string, context: string): Promise<Buffer> {
  const doc = createA4Doc({ title: `Laporan Harian — ${d.locationName}` });

  reportHeader(doc, appName, context, "Laporan Harian");

  doc.font(PDF_FONT.bold).fontSize(16).fillColor(PDF_COLORS.ink).text(d.locationName, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc
    .font(PDF_FONT.regular)
    .fontSize(9.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(`${d.hari}, ${d.tanggalFull}${d.isFinal ? "" : "  ·  PRATINJAU (belum final)"}`, PAGE_MARGIN, doc.y + 1, {
      width: CONTENT_WIDTH,
    });
  doc.y += 8;

  const idRows: [string, string][] = [
    ["Lokasi", `${d.locationName} (${d.regency}, ${d.province})`],
    ["Hari / tanggal", `${d.hari}, ${d.tanggalFull}`],
  ];
  if (d.weekNo != null) idRows.push(["Minggu ke-", String(d.weekNo)]);
  idRows.push(["Tahun anggaran", String(d.tahunAnggaran)]);
  idRows.push(["Status", d.isFinal ? "Final" : "Pratinjau (data live)"]);
  detailBox(doc, idRows);

  kpiRow(
    doc,
    [
      { label: "Total pekerja", value: `${d.totalWorkers} org` },
      { label: "Cuaca", value: d.activeWeather ?? "–" },
      { label: "Jam kerja", value: d.workStart && d.workEnd ? `${d.workStart}–${d.workEnd}` : "–" },
    ],
    CONTENT_WIDTH,
  );

  // Progres pekerjaan hari ini (item dengan volume hari ini).
  sectionHeading(doc, "Progres Pekerjaan Hari Ini");
  const worked = d.items.filter((it) => it.volumeToday !== 0);
  if (worked.length === 0) {
    paragraph(doc, "Tidak ada volume pekerjaan tercatat hari ini.");
  } else {
    const cols: PdfColumn[] = [
      { header: "Uraian Pekerjaan", width: 214 },
      { header: "Sat", width: 45, align: "center" },
      { header: "Hari ini", width: 75, align: "right" },
      { header: "s/d hari ini", width: 85, align: "right" },
      { header: "% Kum.", width: 80, align: "right" },
    ];
    const rows = worked.map((it) => [
      it.name,
      it.unit ?? "–",
      nf(it.volumeToday),
      nf(it.volumeCumulative),
      it.pctCumulative != null ? `${it.pctCumulative.toFixed(1)}%` : "–",
    ]);
    table(doc, cols, rows);
  }

  // Tenaga kerja.
  const workers = (Object.entries(d.workerMap) as [WorkerRole, number][]).filter(([, n]) => n > 0);
  if (workers.length > 0) {
    sectionHeading(doc, "Tenaga Kerja");
    paragraph(
      doc,
      workers.map(([role, n]) => `${WORKER_ROLE_LABEL[role] ?? role}: ${n}`).join("   ·   ") + `   (total ${d.totalWorkers} orang)`,
    );
  }

  // Material & peralatan.
  const mat = d.materials.filter((m) => (m.qty ?? 0) > 0);
  if (mat.length > 0) {
    sectionHeading(doc, "Material");
    paragraph(doc, mat.map((m) => `${m.name}: ${nf(m.qty ?? 0)}${m.unit ? ` ${m.unit}` : ""}`).join("   ·   "));
  }
  const eq = d.equipment.filter((e) => e.count > 0);
  if (eq.length > 0) {
    sectionHeading(doc, "Peralatan");
    paragraph(doc, eq.map((e) => `${e.name}: ${e.count}`).join("   ·   "));
  }

  if (d.notes?.trim()) {
    sectionHeading(doc, "Catatan Lapangan");
    paragraph(doc, d.notes.trim());
  }

  stampFooters(doc, `Dibuat otomatis via ${appName} · ${formatTanggalWaktu(new Date())}`);
  return docToBuffer(doc);
}

/** Muat data harian + render PDF ringkas. Null bila tak ada. TANPA otorisasi (pemanggil gate). */
export async function renderHarianPdf(slug: string, dateKey: string): Promise<HarianPdfResult | null> {
  const [data, branding, loc] = await Promise.all([
    getKkpDailyData(slug, dateKey),
    getBranding(),
    db.location.findUnique({ where: { slug }, select: { id: true } }),
  ]);
  if (!data || !loc) return null;
  const buffer = await buildHarianRingkasPdf(data, branding.appName, branding.projectContext);
  return { buffer, locationId: loc.id };
}
