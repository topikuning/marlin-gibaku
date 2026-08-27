import type PDFDocument from "pdfkit";
import { PDF_COLORS, PDF_FONT } from "./document";

/**
 * Grid bergaris untuk FORMULIR resmi (kotak penuh, mirip tabel Excel/Word) —
 * berbeda dari `table.ts` yang bergaya laporan modern (garis tipis horizontal).
 * Dipakai laporan harian format KKP yang harus tampak seperti blanko baku.
 * DECISIONS 145.
 */

type PdfDoc = InstanceType<typeof PDFDocument>;

export const GRID_LINE = "#64748b"; // slate-500, sama dgn tampilan web
export const GRID_HEAD_BG = "#f8fafc"; // slate-50

export type GridCell = {
  text: string;
  /** Lebar relatif kolom; dipakai bila span > 1 tidak dipakai. */
  span?: number;
  align?: "left" | "center" | "right";
  bold?: boolean;
  head?: boolean;
  /** Warna teks sel; kosong = warna baku (ink / inkMuted untuk kepala). */
  color?: string;
  /** Latar sel; kosong = tanpa latar (kepala tetap memakai latar bakunya). */
  bg?: string;
};

export type GridOptions = {
  x: number;
  width: number;
  /** Lebar tiap kolom (jumlahnya = width). */
  cols: number[];
  fontSize?: number;
  padX?: number;
  padY?: number;
  minRowHeight?: number;
};

/** Tinggi baris yang dibutuhkan (untuk cek muat halaman sebelum menggambar). */
export function gridRowHeight(doc: PdfDoc, cells: GridCell[], o: GridOptions): number {
  const fs = o.fontSize ?? 7.5;
  const padX = o.padX ?? 3;
  const padY = o.padY ?? 2.5;
  const min = o.minRowHeight ?? 12;
  let max = 0;
  let ci = 0;
  for (const c of cells) {
    const span = c.span ?? 1;
    let w = 0;
    for (let k = 0; k < span && ci + k < o.cols.length; k++) w += o.cols[ci + k];
    ci += span;
    doc.font(c.bold || c.head ? PDF_FONT.bold : PDF_FONT.regular).fontSize(fs);
    const h = doc.heightOfString(c.text || " ", { width: Math.max(4, w - padX * 2) });
    if (h > max) max = h;
  }
  return Math.max(min, max + padY * 2);
}

/**
 * Gambar satu baris grid pada posisi y, kembalikan y berikutnya.
 * Sel dengan `span` menggabungkan kolom (colSpan).
 */
export function gridRow(doc: PdfDoc, y: number, cells: GridCell[], o: GridOptions): number {
  const fs = o.fontSize ?? 7.5;
  const padX = o.padX ?? 3;
  const padY = o.padY ?? 2.5;
  const h = gridRowHeight(doc, cells, o);

  let x = o.x;
  let ci = 0;
  for (const c of cells) {
    const span = c.span ?? 1;
    let w = 0;
    for (let k = 0; k < span && ci + k < o.cols.length; k++) w += o.cols[ci + k];
    ci += span;

    const latar = c.bg ?? (c.head ? GRID_HEAD_BG : null);
    if (latar) doc.rect(x, y, w, h).fill(latar);
    doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(GRID_LINE).stroke();
    doc
      .font(c.bold || c.head ? PDF_FONT.bold : PDF_FONT.regular)
      .fontSize(fs)
      .fillColor(c.color ?? (c.head ? PDF_COLORS.inkMuted : PDF_COLORS.ink))
      .text(c.text || " ", x + padX, y + padY, {
        width: Math.max(4, w - padX * 2),
        align: c.align ?? "left",
        lineBreak: true,
      });
    x += w;
  }
  return y + h;
}

/** Bagi lebar total menjadi kolom berdasarkan bobot. */
export function colWidths(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const out = weights.map((w) => (total * w) / sum);
  // Bulatkan supaya total persis (hindari garis kanan meleset 0,x pt).
  const rounded = out.map((v) => Math.round(v * 100) / 100);
  const drift = total - rounded.reduce((s, v) => s + v, 0);
  rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + drift) * 100) / 100;
  return rounded;
}
