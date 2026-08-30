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

/**
 * Nada sel → warna teks + latar lembut.
 *
 * Nilainya diambil dari palet dokumen yang menyalin token layar, jadi "kritis"
 * merah yang sama di layar dan di berkas. Latar hanya dipakai untuk nada yang
 * BUKAN netral: kalau semua sel berlatar, tidak ada yang menonjol.
 */
const NADA: Record<string, { color: string; bg?: string }> = {
  neutral: { color: PDF_COLORS.ink },
  info: { color: PDF_COLORS.info, bg: PDF_COLORS.infoSoft },
  warning: { color: PDF_COLORS.warningStrong, bg: PDF_COLORS.warningSoft },
  danger: { color: PDF_COLORS.danger, bg: PDF_COLORS.dangerSoft },
  success: { color: PDF_COLORS.successStrong, bg: PDF_COLORS.successSoft },
};

const PAGE_W = A4.height;
const PAGE_H = A4.width;
const CONTENT_W = PAGE_W - LANDSCAPE_MARGIN * 2;
const BOTTOM = PAGE_H - LANDSCAPE_MARGIN;

const SOROTAN: Record<string, { bg: string; accent: string }> = {
  neutral: { bg: PDF_COLORS.primary50, accent: PDF_COLORS.primary },
  info: { bg: PDF_COLORS.infoSoft, accent: PDF_COLORS.info },
  warning: { bg: PDF_COLORS.warningSoft, accent: PDF_COLORS.warningStrong },
  danger: { bg: PDF_COLORS.dangerSoft, accent: PDF_COLORS.danger },
  success: { bg: PDF_COLORS.successSoft, accent: PDF_COLORS.successStrong },
};

export type OpsiPdfTabel = {
  /** Nama penanya – tercetak di kop supaya berkas yang diteruskan punya asal. */
  untuk?: string | null;
  /** Waktu pembuatan; disuntik uji supaya keluarannya bisa dibandingkan. */
  dibuatPada?: Date;
};

/** Empat angka utama yang membuka laporan sebelum pembaca masuk ke tabel. */
function gambarSorotan(doc: ReturnType<typeof createLandscapeA4Doc>, t: TabelWa): void {
  if (t.sorotan.length === 0) return;
  const gap = 8;
  const cardW = (CONTENT_W - gap * (t.sorotan.length - 1)) / t.sorotan.length;
  const cardH = 48;
  const top = doc.y + 4;

  t.sorotan.forEach((s, i) => {
    const x = LANDSCAPE_MARGIN + i * (cardW + gap);
    const warna = SOROTAN[s.nada] ?? SOROTAN.neutral;
    doc.roundedRect(x, top, cardW, cardH, 5).fill(warna.bg);
    doc.rect(x, top, 4, cardH).fill(warna.accent);
    doc
      .font(PDF_FONT.bold)
      .fontSize(16)
      .fillColor(warna.accent)
      .text(sanitizeText(s.nilai), x + 12, top + 8, { width: cardW - 20 });
    doc
      .font(PDF_FONT.regular)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.inkMuted)
      .text(sanitizeText(s.label).toUpperCase(), x + 12, top + 30, {
        width: cardW - 20,
        characterSpacing: 0.25,
      });
  });
  doc.y = top + cardH + 10;
  doc.x = LANDSCAPE_MARGIN;
}

/** Catatan metodologi/lingkup sebagai satu callout, bukan deretan teks oranye. */
function gambarCatatan(doc: ReturnType<typeof createLandscapeA4Doc>, catatan: string[]): void {
  if (catatan.length === 0) return;
  const padX = 10;
  const padY = 7;
  const labelH = 10;
  const teks = catatan.map((c) => `• ${sanitizeText(c)}`).join("\n");
  doc.font(PDF_FONT.regular).fontSize(7.5);
  const textH = doc.heightOfString(teks, { width: CONTENT_W - padX * 2 });
  const h = padY * 2 + labelH + textH;
  const top = doc.y;
  doc.roundedRect(LANDSCAPE_MARGIN, top, CONTENT_W, h, 5).fill(PDF_COLORS.primary50);
  doc
    .font(PDF_FONT.bold)
    .fontSize(7)
    .fillColor(PDF_COLORS.primary)
    .text("CATATAN PEMBACAAN", LANDSCAPE_MARGIN + padX, top + padY, {
      width: CONTENT_W - padX * 2,
      characterSpacing: 0.35,
    });
  doc
    .font(PDF_FONT.regular)
    .fontSize(7.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(teks, LANDSCAPE_MARGIN + padX, top + padY + labelH, { width: CONTENT_W - padX * 2 });
  doc.y = top + h + 10;
  doc.x = LANDSCAPE_MARGIN;
}

/** Lima pengecualian terberat; register lengkap tetap disajikan setelahnya. */
function gambarPrioritas(doc: ReturnType<typeof createLandscapeA4Doc>, t: TabelWa): void {
  if (t.prioritas.length === 0) return;
  doc
    .font(PDF_FONT.bold)
    .fontSize(7.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text("PRIORITAS UTAMA", LANDSCAPE_MARGIN, doc.y, {
      width: CONTENT_W,
      characterSpacing: 0.35,
    });
  const opsi: GridOptions = {
    x: LANDSCAPE_MARGIN,
    width: CONTENT_W,
    cols: colWidths(CONTENT_W, [8, 17, 15, 9, 51]),
    fontSize: 8,
    padX: 5,
    padY: 4,
  };
  let y = gridRow(
    doc,
    doc.y + 5,
    ["Tingkat", "Penanggung jawab", "Lokasi", "Umur", "Kendala"].map((text) => ({
      text,
      head: true,
      color: PDF_COLORS.white,
      bg: PDF_COLORS.primary,
    })),
    opsi,
  );
  for (const [i, p] of t.prioritas.entries()) {
    const n = NADA[p.nada] ?? NADA.neutral;
    const zebra = i % 2 === 1 ? "#f8fafc" : undefined;
    y = gridRow(
      doc,
      y,
      [
        { text: p.tingkat, bold: p.nada === "danger", color: n.color, bg: n.bg },
        { text: p.perusahaan, bold: true, bg: zebra },
        { text: p.lokasi, bg: zebra },
        { text: p.umur, align: "center", bg: zebra },
        { text: p.kendala, bg: zebra },
      ],
      opsi,
    );
  }
  doc.y = y;
  doc.x = LANDSCAPE_MARGIN;
}

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
    color: PDF_COLORS.white,
    bg: PDF_COLORS.primary,
  }));

  const dibuat = opts.dibuatPada ?? new Date();
  const konteks = opts.untuk?.trim()
    ? `Dibuat ${formatTanggal(dibuat)} untuk ${sanitizeText(opts.untuk.trim())}`
    : `Dibuat ${formatTanggal(dibuat)}`;

  let registerDimulai = false;

  /** Kop + ringkasan (halaman pertama) + baris judul register. */
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
    const halamanPertama = doc.bufferedPageRange().count === 1;
    if (halamanPertama) {
      gambarSorotan(doc, t);
      gambarCatatan(doc, t.catatan);
      gambarPrioritas(doc, t);
      if (t.prioritas.length > 0) {
        doc.addPage();
        reportHeaderLandscape(doc, "MARLIN", konteks, sanitizeText(t.judul));
        if (t.subjudul) {
          doc
            .font(PDF_FONT.regular)
            .fontSize(8.5)
            .fillColor(PDF_COLORS.inkMuted)
            .text(sanitizeText(t.subjudul), LANDSCAPE_MARGIN, doc.y, { width: CONTENT_W });
        }
      }
    }
    const judulRegister = t.ringkasanKendala
      ? "REGISTER KENDALA LENGKAP PER PERUSAHAAN"
      : "RINCIAN DATA PER PERUSAHAAN";
    doc
      .font(PDF_FONT.bold)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.inkMuted)
      .text(
        registerDimulai ? `${judulRegister} · LANJUTAN` : judulRegister,
        LANDSCAPE_MARGIN,
        doc.y,
        {
          width: CONTENT_W,
          characterSpacing: 0.35,
        },
      );
    registerDimulai = true;
    return gridRow(doc, doc.y + 5, kepala, o);
  };

  let y = kop();
  for (const [barisIndex, baris] of t.baris.entries()) {
    const cells: GridCell[] = baris.map((s, i) => {
      const n = s.nada ? NADA[s.nada] : undefined;
      return {
        text: sanitizeText(s.teks || "–"),
        align: s.align ?? t.kolom[i]?.align ?? "left",
        bold: s.tebal,
        color: n?.color,
        bg: n?.bg ?? (barisIndex % 2 === 1 ? "#f8fafc" : undefined),
      };
    });
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
