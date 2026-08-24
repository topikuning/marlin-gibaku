import "server-only";
import { A4, createLandscapeA4Doc, docToBuffer, LANDSCAPE_MARGIN, PDF_COLORS, PDF_FONT, reportHeaderLandscape, sanitizeText, stampFooters } from "./document";
import { colWidths, gridRow, gridRowHeight, type GridCell, type GridOptions } from "./grid";
import type { BarisTemuan } from "@/lib/findings/queries";
import { formatTanggal } from "@/lib/format";
import { FINDING_CATEGORY_LABEL, FINDING_STATUS_LABEL, ISSUE_SEVERITY_LABEL } from "@/lib/lifecycle";

/**
 * REGISTER TEMUAN → PDF A4 landscape (DECISIONS 426). Menuangkan baris papan
 * `/temuan` APA ADANYA (query + saringan sama dengan layar & .xlsx) — tidak
 * menghitung apa pun.
 */


// Landscape: lebar halaman = tinggi A4.
const PAGE_W = A4.height;
const PAGE_H = A4.width;
const CONTENT_W = PAGE_W - LANDSCAPE_MARGIN * 2;
const BOTTOM = PAGE_H - LANDSCAPE_MARGIN;

const HEAD: GridCell[] = [
  { text: "No", head: true, align: "center" },
  { text: "Judul", head: true },
  { text: "Lokasi", head: true },
  { text: "Kategori", head: true },
  { text: "Tingkat", head: true },
  { text: "Status", head: true },
  { text: "Tgl Temuan", head: true, align: "center" },
  { text: "Tenggat", head: true, align: "center" },
  { text: "Lewat", head: true, align: "center" },
  { text: "Dibuka Ulang", head: true, align: "center" },
  { text: "PIC Tindak Lanjut", head: true },
  { text: "Bukti", head: true, align: "center" },
  { text: "Dicatat Oleh", head: true },
];

export async function buildTemuanRegisterPdf(baris: BarisTemuan[], dibuatOleh: string): Promise<Buffer> {
  const doc = createLandscapeA4Doc({ title: "Register Temuan", author: "MARLIN" });
  const o: GridOptions = {
    x: LANDSCAPE_MARGIN,
    width: CONTENT_W,
    cols: colWidths(CONTENT_W, [4, 26, 14, 9, 7, 12, 8, 8, 5, 7, 12, 5, 11]),
    fontSize: 7.5,
  };

  const kop = (): number => {
    // Kop standar yang sama dengan laporan A4 lain (Laporan Kesiapan dst.).
    reportHeaderLandscape(doc, "MARLIN", `Dibuat ${formatTanggal(new Date())} oleh ${sanitizeText(dibuatOleh)}`, "Register Temuan");
    doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLORS.inkMuted)
      .text(
        sanitizeText(`${baris.length} temuan. Temuan hanya selesai setelah verifikator menutupnya.`),
        LANDSCAPE_MARGIN,
        doc.y,
        { width: CONTENT_W },
      );
    let y = doc.y + 8;
    y = gridRow(doc, y, HEAD, o);
    return y;
  };

  let y = kop();
  baris.forEach((t, i) => {
    const cells: GridCell[] = [
      { text: String(i + 1), align: "center" },
      { text: sanitizeText(t.title) },
      { text: sanitizeText(t.locationName) },
      { text: FINDING_CATEGORY_LABEL[t.category] },
      { text: ISSUE_SEVERITY_LABEL[t.severity], bold: t.severity === "kritis" },
      { text: FINDING_STATUS_LABEL[t.status] },
      { text: formatTanggal(t.findingDate), align: "center" },
      { text: t.dueDate ? formatTanggal(t.dueDate) : "-", align: "center" },
      { text: t.lewatTenggat ? "YA" : "-", align: "center", bold: t.lewatTenggat },
      { text: t.reopenCount > 0 ? `${t.reopenCount}x` : "-", align: "center" },
      { text: sanitizeText(t.assignedName ?? "-") },
      { text: String(t.buktiCount), align: "center" },
      { text: sanitizeText(t.raisedByName) },
    ];
    if (y + gridRowHeight(doc, cells, o) > BOTTOM) {
      doc.addPage();
      y = kop();
    }
    y = gridRow(doc, y, cells, o);
  });

  if (baris.length === 0) {
    doc.font(PDF_FONT.regular).fontSize(9).fillColor(PDF_COLORS.inkMuted)
      .text("Tidak ada temuan yang cocok dengan saringan.", LANDSCAPE_MARGIN, y + 8);
  }

  stampFooters(doc, "MARLIN – Register Temuan");
  return docToBuffer(doc);
}
