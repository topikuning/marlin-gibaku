import "server-only";
import {
  A4,
  createLandscapeA4Doc,
  docToBuffer,
  LANDSCAPE_MARGIN,
  PDF_COLORS,
  PDF_FONT,
  reportHeaderLandscape,
  sanitizeText,
  stampFooters,
} from "./document";
import { colWidths, gridRow, gridRowHeight, type GridCell, type GridOptions } from "./grid";
import type { TabelWa } from "@/lib/waha/tanya-tabel";
import { formatTanggal } from "@/lib/format";

/**
 * Jawaban WhatsApp berdata → TABEL A4 landscape (DECISIONS 448).
 *
 * Satu pencetak untuk SEMUA niat, bukan satu per niat: bentuknya sudah
 * diseragamkan jadi `TabelWa` di `lib/waha/tanya-tabel.ts`, jadi menambah niat
 * baru tidak menambah pencetak baru yang harus ikut diperbaiki tiap kali gaya
 * dokumennya berubah.
 *
 * Ia TIDAK menghitung apa pun dan tidak memilih baris apa pun – seluruh isinya
 * datang jadi. Ukurannya landscape karena kolom keterangan yang panjang
 * (kendala, contoh item) tidak terbaca pada lebar portrait.
 */

const PAGE_W = A4.height;
const PAGE_H = A4.width;
const CONTENT_W = PAGE_W - LANDSCAPE_MARGIN * 2;
const BOTTOM = PAGE_H - LANDSCAPE_MARGIN;

export type OpsiPdfTabel = {
  /** Nama penanya – tercetak di kop supaya berkas yang diteruskan punya asal. */
  untuk?: string | null;
  /** Waktu pembuatan; disuntik uji supaya keluarannya bisa dibandingkan. */
  dibuatPada?: Date;
};

export async function buildTabelWaPdf(t: TabelWa, opts: OpsiPdfTabel = {}): Promise<Buffer> {
  const doc = createLandscapeA4Doc({ title: t.judul, author: "MARLIN" });
  const o: GridOptions = {
    x: LANDSCAPE_MARGIN,
    width: CONTENT_W,
    cols: colWidths(
      CONTENT_W,
      t.kolom.map((k) => k.bobot),
    ),
    fontSize: 7.5,
  };
  const kepala: GridCell[] = t.kolom.map((k) => ({
    text: k.label,
    head: true,
    align: k.align ?? "left",
  }));

  const dibuat = opts.dibuatPada ?? new Date();
  const konteks = opts.untuk?.trim()
    ? `Dibuat ${formatTanggal(dibuat)} untuk ${sanitizeText(opts.untuk.trim())}`
    : `Dibuat ${formatTanggal(dibuat)}`;

  /** Kop + subjudul + catatan + baris judul kolom; kembalikan y berikutnya. */
  const kop = (): number => {
    reportHeaderLandscape(doc, "MARLIN", konteks, sanitizeText(t.judul));
    if (t.subjudul) {
      doc
        .font(PDF_FONT.regular)
        .fontSize(8.5)
        .fillColor(PDF_COLORS.inkMuted)
        .text(sanitizeText(t.subjudul), LANDSCAPE_MARGIN, doc.y, { width: CONTENT_W });
    }
    /*
     * Catatan dicetak di HALAMAN PERTAMA saja, tepat sebelum tabelnya.
     * Mengulangnya di tiap halaman mendorong tabel turun berkali-kali; yang
     * penting ia tidak bisa dilewati sebelum angkanya terbaca – bukan bahwa ia
     * muncul berulang.
     */
    let y = doc.y + 6;
    if (doc.bufferedPageRange().count === 1 && t.catatan.length > 0) {
      doc.font(PDF_FONT.regular).fontSize(7.5).fillColor(PDF_COLORS.warning);
      for (const c of t.catatan) {
        doc.text(sanitizeText(c), LANDSCAPE_MARGIN, doc.y, { width: CONTENT_W });
      }
      y = doc.y + 6;
    }
    return gridRow(doc, y, kepala, o);
  };

  let y = kop();
  for (const baris of t.baris) {
    const cells: GridCell[] = baris.map((s, i) => ({
      text: sanitizeText(s.teks || "–"),
      align: s.align ?? t.kolom[i]?.align ?? "left",
      bold: s.tebal,
    }));
    if (y + gridRowHeight(doc, cells, o) > BOTTOM) {
      doc.addPage();
      y = kop();
    }
    y = gridRow(doc, y, cells, o);
  }

  if (t.baris.length === 0) {
    doc
      .font(PDF_FONT.regular)
      .fontSize(9)
      .fillColor(PDF_COLORS.inkMuted)
      .text("Tidak ada baris yang cocok.", LANDSCAPE_MARGIN, y + 8);
  }

  stampFooters(doc, `MARLIN – ${sanitizeText(t.judul)}`);
  return docToBuffer(doc);
}
