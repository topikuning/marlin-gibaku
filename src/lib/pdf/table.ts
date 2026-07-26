import "server-only";
import {
  CONTENT_BOTTOM,
  PAGE_MARGIN,
  PDF_COLORS,
  PDF_FONT,
  ensureSpace,
  type PdfDoc,
} from "@/lib/pdf/document";

/**
 * Primitif tabel & KPI untuk laporan PDF (harian/mingguan). Tabel: header
 * berwarna + zebra + wrap sel + page-break yang MENGULANG header. DECISIONS 126.
 */

export type PdfColumn = { header: string; width: number; align?: "left" | "right" | "center" };

const CELL_PAD = 5;

function drawHeaderRow(doc: PdfDoc, columns: PdfColumn[], x0: number, y: number): number {
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const h = 20;
  doc.rect(x0, y, totalW, h).fill(PDF_COLORS.primary);
  let x = x0;
  doc.font(PDF_FONT.bold).fontSize(8).fillColor(PDF_COLORS.white);
  for (const c of columns) {
    doc.text(c.header, x + CELL_PAD, y + 6, { width: c.width - CELL_PAD * 2, align: c.align ?? "left", lineBreak: false, ellipsis: true });
    x += c.width;
  }
  return y + h;
}

/** Gambar tabel. rows = array baris (array sel string). Mengembalikan y akhir. */
export function table(doc: PdfDoc, columns: PdfColumn[], rows: string[][]): void {
  const x0 = PAGE_MARGIN;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  ensureSpace(doc, 40);
  let y = drawHeaderRow(doc, columns, x0, doc.y);

  doc.font(PDF_FONT.regular).fontSize(8);
  rows.forEach((cells, i) => {
    // Tinggi baris = maksimum tinggi sel (sel bisa wrap).
    const rowH =
      Math.max(
        ...columns.map((c, ci) =>
          doc.heightOfString(cells[ci] ?? "", { width: c.width - CELL_PAD * 2 }),
        ),
        12,
      ) + CELL_PAD * 2;

    if (y + rowH > CONTENT_BOTTOM) {
      doc.addPage();
      y = drawHeaderRow(doc, columns, x0, doc.y);
      doc.font(PDF_FONT.regular).fontSize(8);
    }

    if (i % 2 === 1) doc.rect(x0, y, totalW, rowH).fill(PDF_COLORS.primary50);
    let x = x0;
    doc.fillColor(PDF_COLORS.ink);
    for (let ci = 0; ci < columns.length; ci++) {
      const c = columns[ci];
      doc.text(cells[ci] ?? "", x + CELL_PAD, y + CELL_PAD, { width: c.width - CELL_PAD * 2, align: c.align ?? "left" });
      x += c.width;
    }
    // Garis bawah tipis.
    doc.moveTo(x0, y + rowH).lineTo(x0 + totalW, y + rowH).lineWidth(0.4).strokeColor(PDF_COLORS.border).stroke();
    y += rowH;
  });

  // Bingkai luar.
  doc.y = y;
  doc.moveTo(x0, y).lineTo(x0 + totalW, y).stroke();
  doc.x = PAGE_MARGIN;
  doc.y = y + 6;
}

export type Kpi = { label: string; value: string; tone?: "default" | "success" | "warning" | "danger" };

const TONE_COLOR: Record<NonNullable<Kpi["tone"]>, string> = {
  default: PDF_COLORS.primary,
  success: PDF_COLORS.success,
  warning: PDF_COLORS.warning,
  danger: "#b91c1c",
};

/** Baris kartu KPI (angka besar + label). Membagi lebar konten rata. */
export function kpiRow(doc: PdfDoc, items: Kpi[], contentWidth: number): void {
  if (items.length === 0) return;
  ensureSpace(doc, 54);
  const gap = 8;
  const cardW = (contentWidth - gap * (items.length - 1)) / items.length;
  const cardH = 46;
  const y = doc.y;
  items.forEach((k, i) => {
    const x = PAGE_MARGIN + i * (cardW + gap);
    doc.roundedRect(x, y, cardW, cardH, 5).lineWidth(0.8).strokeColor(PDF_COLORS.border).fillAndStroke(PDF_COLORS.white, PDF_COLORS.border);
    doc
      .font(PDF_FONT.bold)
      .fontSize(15)
      .fillColor(TONE_COLOR[k.tone ?? "default"])
      .text(k.value, x + 8, y + 8, { width: cardW - 16, lineBreak: false, ellipsis: true });
    doc
      .font(PDF_FONT.regular)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.inkMuted)
      .text(k.label.toUpperCase(), x + 8, y + 28, { width: cardW - 16, characterSpacing: 0.3, lineBreak: false, ellipsis: true });
  });
  doc.y = y + cardH + 8;
  doc.x = PAGE_MARGIN;
}
