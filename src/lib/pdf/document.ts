import "server-only";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type PDFDocumentType from "pdfkit";

/**
 * pdfkit dimuat dari BUNDLE PREBUILT SELF-CONTAINED yang DI-VENDOR ke
 * `assets/pdfkit-standalone.cjs` (fontkit + @swc/helpers dll. sudah di-inline,
 * TANPA dependensi eksternal). Ini menghindari DUA jebakan pnpm + Next standalone:
 *  1) menyalin dep per-file MERUSAK symlink pnpm yang memaku fontkit ke versi
 *     @swc/helpers-nya → "applyDecoratedDescriptor is not a function";
 *  2) Next standalone TIDAK membuat symlink `node_modules/pdfkit` untuk paket yang
 *     hanya dipanggil via createRequire → "Cannot find module 'pdfkit/js/...'".
 * Dengan MEMUAT lewat path absolut file yang kita bawa sendiri (di-copy Dockerfile
 * lewat `assets/`), resolusi node_modules TAK terlibat sama sekali. DECISIONS 128.
 */
const nodeRequire = createRequire(path.join(process.cwd(), "index.js"));
const PDFDocument = nodeRequire(
  path.join(process.cwd(), "assets", "pdfkit-standalone.cjs"),
) as typeof PDFDocumentType;

/**
 * Fondasi dokumen PDF server-side (pdfkit) — dipakai lintas jenis laporan
 * (kegiatan lapangan, eksekutif, dst.). DECISIONS 124.
 *
 * KENAPA pdfkit (bukan headless Chromium): runner produksi = node:slim TANPA
 * Chromium; menambah Playwright/Chromium ke image runtime berat & rapuh di
 * Railway. pdfkit murni-Node, teks vektor (bisa diseleksi), alir teks + page
 * break otomatis (penting: narasi bisa panjang), foto ditanam via sharp.
 *
 * Font: DejaVu Sans (TTF) yang SUDAH dibawa aplikasi di assets/fonts (dan
 * di-trace ke standalone lewat outputFileTracingIncludes). Kita DAFTARKAN font
 * ini dan tidak pernah menyentuh font AFM bawaan pdfkit → hindari jebakan
 * tracing file .afm pada build standalone.
 */

/** Palet warna dokumen — selaras token aplikasi (globals.css). */
export const PDF_COLORS = {
  primary: "#1e3a8a", // --color-primary (navy)
  primary600: "#2563eb",
  primary50: "#eff6ff",
  ink: "#1f2937",
  inkMuted: "#4b5563",
  inkFaint: "#9ca3af",
  border: "#e5e7eb",
  warning: "#b45309",
  success: "#15803d",
  white: "#ffffff",
} as const;

/** Nama font terdaftar (dipakai via doc.font(...)). */
export const PDF_FONT = { regular: "body", bold: "bold" } as const;

// A4 (pt) & margin standar dokumen.
export const A4 = { width: 595.28, height: 841.89 } as const;
export const PAGE_MARGIN = 48;
export const CONTENT_WIDTH = A4.width - PAGE_MARGIN * 2;
/** Batas bawah area konten (untuk keputusan page-break manual). */
export const CONTENT_BOTTOM = A4.height - PAGE_MARGIN;

let fontCache: { regular: Buffer; bold: Buffer } | null = null;

/** Muat (sekali) buffer font DejaVu dari assets. process.cwd() = root app di dev & standalone. */
function loadFonts(): { regular: Buffer; bold: Buffer } {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "assets", "fonts");
  fontCache = {
    regular: readFileSync(path.join(dir, "DejaVuSans.ttf")),
    bold: readFileSync(path.join(dir, "DejaVuSans-Bold.ttf")),
  };
  return fontCache;
}

export type PdfDoc = InstanceType<typeof PDFDocument>;

/** Buat dokumen A4 dengan font aplikasi terdaftar & font default = body. */
export function createA4Doc(meta?: { title?: string; author?: string }): PdfDoc {
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    autoFirstPage: true,
    bufferPages: true,
    info: {
      Title: meta?.title ?? "Laporan MARLIN",
      Author: meta?.author ?? "MARLIN",
      Producer: "MARLIN",
    },
  });
  const fonts = loadFonts();
  doc.registerFont(PDF_FONT.regular, fonts.regular);
  doc.registerFont(PDF_FONT.bold, fonts.bold);
  doc.font(PDF_FONT.regular);
  return doc;
}

/** Margin A4 lanskap — lebih rapat, blanko resmi butuh lebar maksimal. */
export const LANDSCAPE_MARGIN = 28;

/**
 * A4 LANSKAP untuk blanko/formulir bertabel lebar (mis. laporan harian KKP
 * dengan matriks cuaca 16 kolom). Font & metadata sama dgn createA4Doc.
 */
export function createLandscapeA4Doc(meta?: { title?: string; author?: string }): PdfDoc {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: LANDSCAPE_MARGIN,
    autoFirstPage: true,
    bufferPages: true,
    info: {
      Title: meta?.title ?? "Laporan MARLIN",
      Author: meta?.author ?? "MARLIN",
      Producer: "MARLIN",
    },
  });
  const fonts = loadFonts();
  doc.registerFont(PDF_FONT.regular, fonts.regular);
  doc.registerFont(PDF_FONT.bold, fonts.bold);
  doc.font(PDF_FONT.regular);
  return doc;
}

/** Selesaikan dokumen → Buffer PDF. Selalu memanggil doc.end() sekali. */
export function docToBuffer(doc: PdfDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/* ── Sanitasi teks ───────────────────────────────────────────────────────── */

/**
 * Buang karakter yang TIDAK ada di font DejaVu (emoji, simbol/dingbat, variation
 * selector, zero-width, kontrol) → cegah kotak tofu "□" di PDF. Latin beraksen,
 * tanda baca, ·, →, ©®™ tetap dipertahankan. DECISIONS 129.
 */
export function sanitizeText(s: string): string {
  // Buang karakter yang tak ada di DejaVu (emoji/simbol/kontrol/zero-width)
  // agar tak jadi kotak tofu di PDF. Latin beraksen & tanda baca dipertahankan.
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10) { out += ch; continue; } // tab, newline
    if (c < 32 || c === 127) continue; // kontrol lain
    if (c >= 0x200b && c <= 0x200d) continue; // zero-width
    if (c === 0x2060 || c === 0xfeff) continue; // word-joiner / BOM
    if (c >= 0xfe00 && c <= 0xfe0f) continue; // variation selectors
    if (c >= 0x2600 && c <= 0x27bf) continue; // simbol lain-lain & dingbat
    if (c >= 0x2b00 && c <= 0x2bff) continue; // panah/simbol tambahan
    if (c >= 0x1f000 && c <= 0x1faff) continue; // bidang emoji
    out += ch;
  }
  return out;
}

/* ── Primitif tata letak ─────────────────────────────────────────────────── */

/** Kop laporan: nama app + konteks proyek (kiri) & judul dokumen (kanan), garis navy. */
export function reportHeader(doc: PdfDoc, appName: string, context: string, title: string): void {
  const top = PAGE_MARGIN;
  const leftW = CONTENT_WIDTH * 0.5 - 8;
  const rightX = PAGE_MARGIN + CONTENT_WIDTH * 0.5 + 8;
  const rightW = CONTENT_WIDTH * 0.5 - 8;
  doc
    .font(PDF_FONT.bold)
    .fontSize(9)
    .fillColor(PDF_COLORS.inkMuted)
    .text(sanitizeText(appName).toUpperCase(), PAGE_MARGIN, top, { characterSpacing: 1, width: leftW });
  doc
    .font(PDF_FONT.regular)
    .fontSize(8)
    .fillColor(PDF_COLORS.inkMuted)
    .text(sanitizeText(context), PAGE_MARGIN, doc.y + 1, { width: leftW });
  const leftBottom = doc.y;
  // Judul di KOLOM KANAN saja (boleh wrap) — tak menabrak teks kiri.
  doc
    .font(PDF_FONT.bold)
    .fontSize(15)
    .fillColor(PDF_COLORS.primary)
    .text(sanitizeText(title).toUpperCase(), rightX, top, { width: rightW, align: "right" });
  const lineY = Math.max(leftBottom, doc.y, top + 34) + 4;
  doc.moveTo(PAGE_MARGIN, lineY).lineTo(PAGE_MARGIN + CONTENT_WIDTH, lineY).lineWidth(2.5).strokeColor(PDF_COLORS.primary).stroke();
  doc.y = lineY + 12;
  doc.x = PAGE_MARGIN;
}

/** Blok identitas: judul besar + subteks + kotak rincian (label:value). */
export function detailBox(doc: PdfDoc, rows: [string, string][]): void {
  const boxX = PAGE_MARGIN;
  const boxW = CONTENT_WIDTH;
  const padIn = 10;
  const startY = doc.y;
  let y = startY + padIn;
  for (const [label, value] of rows) y = metaRow(doc, label, value, boxX + padIn, y, boxW - padIn * 2);
  const boxH = y - startY + padIn - 4;
  doc.roundedRect(boxX, startY, boxW, boxH, 6).lineWidth(0.8).strokeColor(PDF_COLORS.border).stroke();
  doc.y = startY + boxH + 8;
  doc.x = PAGE_MARGIN;
}

/** Judul section bergaris bawah aksen (uppercase, seperti laporan cetak). */
export function sectionHeading(doc: PdfDoc, title: string): void {
  ensureSpace(doc, 34);
  const y = doc.y;
  doc
    .font(PDF_FONT.bold)
    .fontSize(10.5)
    .fillColor(PDF_COLORS.primary)
    .text(title.toUpperCase(), PAGE_MARGIN, y, { characterSpacing: 0.4, width: CONTENT_WIDTH });
  const lineY = doc.y + 2;
  doc
    .moveTo(PAGE_MARGIN, lineY)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, lineY)
    .lineWidth(1.4)
    .strokeColor(PDF_COLORS.primary600)
    .stroke();
  doc.y = lineY + 8;
  doc.x = PAGE_MARGIN;
}

/** Paragraf isi (rata kiri, warna ink). Menghormati alir & page-break pdfkit. */
export function paragraph(doc: PdfDoc, text: string): void {
  doc
    .font(PDF_FONT.regular)
    .fontSize(10)
    .fillColor(PDF_COLORS.ink)
    .text(sanitizeText(text), PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 2, align: "left" });
}

/** Baris "label : nilai" dalam kotak rincian. Mengembalikan y setelah baris. */
export function metaRow(doc: PdfDoc, label: string, value: string, x: number, y: number, width: number): number {
  const labelW = 96;
  const val = sanitizeText(value);
  doc.font(PDF_FONT.bold).fontSize(9.5).fillColor(PDF_COLORS.inkMuted).text(sanitizeText(label), x, y, { width: labelW });
  const valH = doc.heightOfString(val, { width: width - labelW - 8 });
  doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(PDF_COLORS.ink).text(val, x + labelW + 8, y, {
    width: width - labelW - 8,
  });
  return y + Math.max(doc.currentLineHeight(), valH) + 4;
}

/** Pastikan tersedia `need` pt sebelum batas bawah; kalau tidak, tambah halaman. */
export function ensureSpace(doc: PdfDoc, need: number): void {
  if (doc.y + need > CONTENT_BOTTOM) doc.addPage();
}

/**
 * Kaki halaman pada SEMUA halaman: sumber + waktu (kiri) & "Hal. i/n" (kanan).
 * Menulis DI PITA MARGIN bawah: pdfkit menambah halaman baru bila teks melewati
 * batas bawah margin, jadi margin bawah di-nol-kan sementara saat menulis kaki
 * (kalau tidak, tiap kaki malah membuat halaman kosong baru). DECISIONS 124.
 */
export function stampFooters(doc: PdfDoc, leftText: string): void {
  const range = doc.bufferedPageRange();
  const y = A4.height - PAGE_MARGIN + 14;
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // izinkan menulis di pita margin tanpa memicu halaman baru
    doc.font(PDF_FONT.regular).fontSize(7.5).fillColor(PDF_COLORS.inkFaint);
    doc.text(leftText, PAGE_MARGIN, y, { width: CONTENT_WIDTH * 0.7, lineBreak: false });
    doc.text(`Hal. ${i + 1}/${range.count}`, PAGE_MARGIN, y, {
      width: CONTENT_WIDTH,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }
}
