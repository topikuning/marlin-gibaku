import "server-only";
import {
  CONTENT_WIDTH,
  PAGE_MARGIN,
  PDF_FONT,
  createA4Doc,
  docToBuffer,
  ensureSpace,
  sanitizeText,
  type PdfDoc,
} from "./document";
import type { Blok, Run, SuratTersusun } from "@/lib/surat-penyedia/aturan";

/**
 * PDF SURAT BERKOP PENYEDIA (DECISIONS 716). Isi kalimatnya TIDAK ditulis di
 * sini – semuanya datang sebagai blok dari `surat-penyedia/aturan.ts`, yang
 * juga dipakai penggambar Word, supaya PDF dan Word tidak pernah berbeda isi.
 */

/** Kop surat: gambar kop jadi milik perusahaan, atau disusun dari datanya. */
export type KopSurat = {
  /** Gambar kop utuh (master Perusahaan › kop) – menang bila ada. */
  gambar: Buffer | null;
  logo: Buffer | null;
  nama: string;
  alamat: string | null;
  telepon: string | null;
  email: string | null;
};

const UKURAN = 11;
const JARAK = 3;
const LEBAR_LABEL = 120;
const LEBAR_TITIK_DUA = 12;

/**
 * Pada rata kanan-kiri pdfkit memangkas spasi di AWAL potongan bersambung
 * ("800,-(Dua"), sedangkan spasi di AKHIR potongan tetap tampil. Jadi spasi
 * pembuka dipindah ke ujung potongan sebelumnya.
 */
export function rapikanSpasiRuns(isi: Run[]): Run[] {
  const runs = isi.filter((r) => r.teks.length > 0).map((r) => ({ ...r }));
  for (let i = 1; i < runs.length; i++) {
    const awal = runs[i].teks.match(/^\s+/);
    if (!awal) continue;
    runs[i].teks = runs[i].teks.slice(awal[0].length);
    if (!/\s$/.test(runs[i - 1].teks)) runs[i - 1].teks += " ";
  }
  return runs.filter((r) => r.teks.length > 0);
}

function tulisRuns(doc: PdfDoc, isi: Run[], opsi: { x: number; width: number; align: PDFKit.Mixins.TextOptions["align"] }) {
  const runs = rapikanSpasiRuns(isi);
  if (runs.length === 0) return;
  runs.forEach((r, i) => {
    doc.font(r.tebal ? PDF_FONT.bold : PDF_FONT.regular);
    const lanjut = i < runs.length - 1;
    const teks = sanitizeText(r.teks);
    if (i === 0) {
      doc.text(teks, opsi.x, doc.y, {
        width: opsi.width,
        align: opsi.align,
        continued: lanjut,
        underline: r.garisBawah ?? false,
        lineGap: JARAK,
      });
    } else {
      doc.text(teks, { continued: lanjut, underline: r.garisBawah ?? false, lineGap: JARAK });
    }
  });
  doc.font(PDF_FONT.regular);
}

function tinggiRuns(doc: PdfDoc, isi: Run[], width: number): number {
  doc.font(PDF_FONT.regular);
  return doc.heightOfString(sanitizeText(isi.map((r) => r.teks).join("")), { width, lineGap: JARAK });
}

function gambarKop(doc: PdfDoc, kop: KopSurat): void {
  const atas = PAGE_MARGIN - 14;
  if (kop.gambar) {
    try {
      doc.image(kop.gambar, PAGE_MARGIN, atas, { fit: [CONTENT_WIDTH, 95], align: "center" });
      doc.y = atas + 100;
      return;
    } catch (err) {
      console.error("[surat-penyedia] gambar kop gagal digambar, memakai kop teks:", err);
    }
  }
  const tinggiLogo = 62;
  let x = PAGE_MARGIN;
  if (kop.logo) {
    try {
      doc.image(kop.logo, PAGE_MARGIN, atas, { fit: [tinggiLogo, tinggiLogo], align: "center", valign: "center" });
      x = PAGE_MARGIN + tinggiLogo + 12;
    } catch (err) {
      console.error("[surat-penyedia] logo gagal digambar di kop:", err);
    }
  }
  const lebar = PAGE_MARGIN + CONTENT_WIDTH - x;
  doc.font(PDF_FONT.bold).fontSize(17).text(sanitizeText(kop.nama.toUpperCase()), x, atas + 4, { width: lebar });
  doc.font(PDF_FONT.regular).fontSize(9);
  if (kop.alamat) doc.text(sanitizeText(kop.alamat), x, doc.y + 2, { width: lebar });
  const kontak = [kop.telepon && `Telp. ${kop.telepon}`, kop.email && `Email ${kop.email}`].filter(Boolean).join(" · ");
  if (kontak) doc.text(sanitizeText(kontak), x, doc.y + 1, { width: lebar });
  const garis = Math.max(doc.y + 6, atas + tinggiLogo + 6);
  doc.moveTo(PAGE_MARGIN, garis).lineTo(PAGE_MARGIN + CONTENT_WIDTH, garis).lineWidth(1.6).stroke("#111111");
  doc.moveTo(PAGE_MARGIN, garis + 3).lineTo(PAGE_MARGIN + CONTENT_WIDTH, garis + 3).lineWidth(0.6).stroke("#111111");
  doc.fontSize(UKURAN);
  doc.y = garis + 16;
}

function gambarBlok(doc: PdfDoc, b: Blok): void {
  const x = PAGE_MARGIN;
  switch (b.jenis) {
    case "paragraf": {
      doc.y += b.jarakAtas ?? 6;
      ensureSpace(doc, Math.min(120, tinggiRuns(doc, b.isi, CONTENT_WIDTH)));
      tulisRuns(doc, b.isi, {
        x,
        width: CONTENT_WIDTH,
        align: b.rata === "penuh" ? "justify" : b.rata === "kanan" ? "right" : b.rata === "tengah" ? "center" : "left",
      });
      return;
    }
    case "judul": {
      doc.y += 10;
      ensureSpace(doc, 40);
      doc.font(PDF_FONT.bold).fontSize(14).text(sanitizeText(b.teks), x, doc.y, {
        width: CONTENT_WIDTH,
        align: "center",
        underline: true,
      });
      doc.font(PDF_FONT.regular).fontSize(UKURAN);
      if (b.sub) doc.text(sanitizeText(b.sub), x, doc.y + 2, { width: CONTENT_WIDTH, align: "center" });
      doc.y += 6;
      return;
    }
    case "pasangan": {
      doc.y += 6;
      const xIsi = x + LEBAR_LABEL + LEBAR_TITIK_DUA;
      const lebarIsi = CONTENT_WIDTH - LEBAR_LABEL - LEBAR_TITIK_DUA;
      for (const baris of b.baris) {
        const tinggi = Math.max(tinggiRuns(doc, baris.isi, lebarIsi), UKURAN + JARAK);
        ensureSpace(doc, tinggi);
        const y = doc.y;
        doc.font(PDF_FONT.regular).text(sanitizeText(baris.label), x, y, { width: LEBAR_LABEL, lineGap: JARAK });
        doc.text(":", x + LEBAR_LABEL, y, { width: LEBAR_TITIK_DUA, lineGap: JARAK });
        doc.y = y;
        tulisRuns(doc, baris.isi, { x: xIsi, width: lebarIsi, align: "left" });
        doc.y = y + tinggi + 2;
      }
      return;
    }
    case "daftar": {
      doc.y += 2;
      b.butir.forEach((butir, i) => {
        const teks = sanitizeText(butir);
        const tinggi = doc.heightOfString(teks, { width: CONTENT_WIDTH - 22, lineGap: JARAK });
        ensureSpace(doc, tinggi);
        const y = doc.y;
        doc.text(`${i + 1}.`, x + 4, y, { width: 18, lineGap: JARAK });
        doc.text(teks, x + 22, y, { width: CONTENT_WIDTH - 22, lineGap: JARAK });
      });
      return;
    }
    case "ttd": {
      doc.y += 18;
      ensureSpace(doc, 150);
      const lebar = CONTENT_WIDTH * 0.45;
      const xKanan = x + CONTENT_WIDTH - lebar;
      const atas = doc.y;
      if (b.kotakNominal) {
        const tinggiKotak = 34;
        const yKotak = atas + 40;
        doc.rect(x, yKotak, CONTENT_WIDTH * 0.42, tinggiKotak).lineWidth(1).stroke("#111111");
        doc.font(PDF_FONT.bold).fontSize(13).text(sanitizeText(b.kotakNominal), x, yKotak + 10, {
          width: CONTENT_WIDTH * 0.42,
          align: "center",
        });
        doc.font(PDF_FONT.regular).fontSize(UKURAN);
      }
      doc.y = atas;
      if (b.tempatTanggal) doc.text(sanitizeText(b.tempatTanggal), xKanan, doc.y, { width: lebar, align: "center" });
      doc.text(sanitizeText(b.salam), xKanan, doc.y, { width: lebar, align: "center" });
      doc.font(PDF_FONT.bold).text(sanitizeText(b.perusahaan), xKanan, doc.y, { width: lebar, align: "center" });
      doc.font(PDF_FONT.regular);
      const yRuang = doc.y + 4;
      if (b.meterai) {
        doc.rect(xKanan + lebar / 2 - 60, yRuang + 4, 52, 46).dash(2, { space: 2 }).lineWidth(0.6).stroke("#888888");
        doc.undash();
        doc.fontSize(7).fillColor("#888888").text("Meterai", xKanan + lebar / 2 - 60, yRuang + 20, { width: 52, align: "center" });
        doc.fillColor("#111111").fontSize(UKURAN);
      }
      doc.y = yRuang + 62;
      doc.font(PDF_FONT.bold).text(sanitizeText(b.nama), xKanan, doc.y, { width: lebar, align: "center", underline: true });
      doc.font(PDF_FONT.regular).text(sanitizeText(b.jabatan), xKanan, doc.y, { width: lebar, align: "center" });
      return;
    }
  }
}

export async function buatPdfSurat(surat: SuratTersusun, kop: KopSurat): Promise<Buffer> {
  const doc = createA4Doc({ title: surat.judulBerkas, author: kop.nama });
  doc.fontSize(UKURAN);
  gambarKop(doc, kop);
  for (const b of surat.blok) gambarBlok(doc, b);
  return docToBuffer(doc);
}
