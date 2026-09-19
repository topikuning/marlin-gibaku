import "server-only";
import { DECK_169, PDF_FONT, sanitizeText, type PdfDoc } from "@/lib/pdf/document";
import type { TemaDeck } from "@/lib/paparan/tema";
import { turunanTema, warnaChip, type TurunanTema } from "./warna";

/**
 * PRIMITIF DECK 16:9 BERTEMA — dipakai Paparan Mingguan KKP (lib/paparan/
 * render-pdf.ts) dan deck laporan lengkap lokasi (lib/lokasi-lengkap/
 * render-deck.ts). Satu tempat untuk latar, judul, footer, kartu, tabel, chip,
 * kurva, sampul, penutup; TEMA (`lib/paparan/tema.ts`) menentukan rupanya.
 *
 * Yang bertema hanya RUPA. Primitif ini tidak tahu angka dari mana — pemanggil
 * memberi string yang sudah diformat dari calculation layer kanonik.
 *
 * Tema "mataram" = desain asli DECISIONS 417: setiap koordinat dan ukuran di
 * jalur mataram dipertahankan persis supaya deck yang sudah terbit tidak
 * berubah rupa hanya karena primitifnya dipindah ke sini.
 */

export type DeckCtx = {
  doc: PdfDoc;
  tema: TemaDeck;
  W: number;
  H: number;
  MX: number;
  CW: number;
  /**
   * Warna sekunder turunan palet (cache). OPSIONAL supaya ctx yang dirakit
   * tangan — tanpa ruas ini — tetap sah: turunannya dihitung saat dibutuhkan.
   */
  t?: TurunanTema;
};

const W = DECK_169.width;
const H = DECK_169.height;
const MX = 52;
const CW = W - MX * 2;

export function buatDeckCtx(doc: PdfDoc, tema: TemaDeck): DeckCtx {
  return { doc, tema, W, H, MX, CW, t: turunanTema(tema) };
}

function s(t: string): string {
  return sanitizeText(t);
}

/** Warna turunan ctx; dihitung bila ctx dirakit tanpa cache `t`. */
function tur(ctx: DeckCtx): TurunanTema {
  return ctx.t ?? turunanTema(ctx.tema);
}

function pctLabel(v: number): string {
  return `${v.toFixed(1).replace(".", ",")}%`;
}

/* ── Gelap / terang ─────────────────────────────────────────────────────── */

/**
 * Slide isi ke-`urutan` (0-based) gelap? Tema berselang: 0 terang, 1 gelap,
 * 2 terang, … Tema tanpa selang: selalu terang.
 */
export function slideGelap(tema: TemaDeck, urutan: number): boolean {
  return tema.berselang && urutan % 2 === 1;
}

/** Sampul & penutup gelap ⇔ tema berselang — untuk memilih warna footer/watermark di kedua slide itu. */
export function bingkaiGelap(tema: TemaDeck): boolean {
  return tema.berselang;
}

/* ── Warna pembantu untuk goresan bebas renderer ────────────────────────── */

export function warnaTeks(ctx: DeckCtx, gelap: boolean): string {
  return gelap ? ctx.tema.palet.putih : ctx.tema.palet.ink;
}
export function warnaRedup(ctx: DeckCtx, gelap: boolean): string {
  return gelap ? tur(ctx).teksRedupGelap : ctx.tema.palet.inkMuted;
}
export function warnaSamar(ctx: DeckCtx, gelap: boolean): string {
  return gelap ? tur(ctx).teksSamarGelap : ctx.tema.palet.inkFaint;
}
export function warnaGaris(ctx: DeckCtx, gelap: boolean): string {
  return gelap ? tur(ctx).garisGelap : ctx.tema.palet.garis;
}
export function warnaSorot(ctx: DeckCtx, gelap: boolean): string {
  return gelap ? ctx.tema.palet.gelapKartu : tur(ctx).aksenSorot;
}
export function warnaTrekBar(ctx: DeckCtx, gelap: boolean): string {
  return gelap ? ctx.tema.palet.gelapKartu : tur(ctx).trekBar;
}
/** Warna aksen untuk TEKS: di latar terang memakai aksen tua supaya terbaca. */
function aksenTeks(ctx: DeckCtx, gelap: boolean): string {
  return gelap ? ctx.tema.palet.aksen : ctx.tema.palet.aksenTua;
}

/* ── Teks ───────────────────────────────────────────────────────────────── */

/**
 * Potong teks agar muat SATU baris selebar `maxW` pada font/ukuran aktif.
 * `ellipsis` pdfkit tidak bisa diandalkan tanpa batas tinggi (nama kategori
 * panjang tetap turun baris dan tertindih bar — ketahuan dari PNG hasil
 * render); pemotongan manual berbasis `widthOfString` deterministik.
 */
export function potongTeks(ctx: DeckCtx, teks: string, maxW: number): string {
  const doc = ctx.doc;
  const t = s(teks);
  if (doc.widthOfString(t) <= maxW) return t;
  let n = t.length;
  while (n > 1 && doc.widthOfString(`${t.slice(0, n)}…`) > maxW) n -= 1;
  return `${t.slice(0, n).trimEnd()}…`;
}

/* ── Latar ──────────────────────────────────────────────────────────────── */

/** Hiasan tepi slide TERANG per gaya tema — satu deck satu wajah. */
function motifTerang(ctx: DeckCtx): void {
  const { doc, tema } = ctx;
  if (tema.sampul === "pita_atas") {
    doc.rect(0, 0, W, 6).fillColor(tema.palet.aksen).fill();
  } else if (tema.sampul === "pusat") {
    doc.rect(0, 0, W, 6).fillColor(tema.palet.aksen).fill();
    doc.rect(0, H - 4, W, 4).fillColor(tema.palet.primer).fill();
  }
}

export function latarSlide(ctx: DeckCtx, gelap: boolean): void {
  const { doc, tema } = ctx;
  if (!gelap) {
    doc.rect(0, 0, W, H).fillColor(tema.palet.terang).fill();
    motifTerang(ctx);
    return;
  }
  doc.rect(0, 0, W, H).fillColor(tema.palet.gelap).fill();
  // Bilah aksen tipis di tepi kiri + hiasan samar kanan atas.
  doc.rect(0, 0, 5, H).fillColor(tema.palet.aksen).fill();
  doc.save();
  doc.lineWidth(1).strokeColor(tur(ctx).garisGelap);
  if (tema.sudutKartu > 0) {
    doc.circle(W - 90, 170, 150).stroke();
    doc.circle(W - 90, 170, 95).stroke();
  } else {
    // Tema bersudut kotak: belah ketupat, bukan lingkaran.
    const cx = W - 90;
    const cy = 170;
    for (const r of [150, 95]) {
      doc.moveTo(cx, cy - r).lineTo(cx + r, cy).lineTo(cx, cy + r).lineTo(cx - r, cy).closePath().stroke();
    }
  }
  doc.restore();
}

/* ── Judul slide ────────────────────────────────────────────────────────── */

/** Judul slide; mengembalikan y awal isi. Mengikuti `tema.judul`. */
export function judulSlide(ctx: DeckCtx, teks: string, gelap: boolean): number {
  const { doc, tema } = ctx;
  const p = tema.palet;
  const yJudul = gelap ? 60 : 42;
  switch (tema.judul) {
    case "garis_bawah": {
      doc.font(PDF_FONT.bold).fontSize(21).fillColor(gelap ? p.putih : p.ink).text(s(teks), MX, yJudul, { width: CW });
      const y = doc.y + 8;
      doc.moveTo(MX, y).lineTo(MX + CW, y).lineWidth(1.6).strokeColor(p.aksen).stroke();
      return y + (gelap ? 20 : 18);
    }
    case "pita_kiri": {
      doc.font(PDF_FONT.bold).fontSize(21).fillColor(gelap ? p.putih : p.ink).text(s(teks), MX + 16, yJudul, { width: CW - 16 });
      const tinggi = doc.y - yJudul;
      doc.rect(MX, yJudul - 1, 6, tinggi + 2).fillColor(p.aksen).fill();
      return doc.y + (gelap ? 28 : 26);
    }
    case "blok": {
      doc.font(PDF_FONT.bold).fontSize(21);
      const th = doc.heightOfString(s(teks), { width: CW });
      const bh = Math.max(76, th + 44);
      doc.rect(0, 0, W, bh).fillColor(gelap ? p.gelapKartu : p.primer).fill();
      doc.rect(0, bh, W, 3).fillColor(p.aksen).fill();
      doc.fillColor(p.putih).text(s(teks), MX, (bh - th) / 2 + 1, { width: CW });
      return bh + 3 + 22;
    }
  }
}

/* ── Footer & watermark ─────────────────────────────────────────────────── */

export function footerSlide(ctx: DeckCtx, kiri: string, nomor: number, total: number, gelap: boolean): void {
  const { doc, tema } = ctx;
  const y = H - 22;
  doc.font(PDF_FONT.regular).fontSize(7.5).fillColor(gelap ? tur(ctx).footerGelap : tema.palet.inkFaint);
  doc.text(s(kiri), MX, y, { width: CW - 80, lineBreak: false });
  doc.text(`${nomor}/${total}`, MX, y, { width: CW, align: "right", lineBreak: false });
}

export function watermarkDraf(ctx: DeckCtx, gelap: boolean): void {
  const { doc } = ctx;
  doc.save();
  doc.font(PDF_FONT.bold).fontSize(44).fillColor(gelap ? "#f87171" : "#dc2626").opacity(gelap ? 0.18 : 0.12);
  doc.rotate(-18, { origin: [W / 2, H / 2] });
  doc.text("DRAF – BELUM DISETUJUI", 0, H / 2 - 28, { width: W, align: "center" });
  doc.restore();
  doc.opacity(1);
}

/* ── Chip ───────────────────────────────────────────────────────────────── */

/**
 * Chip berlabel; mengembalikan lebarnya.
 * - `warna` + `teksWarna`: dipakai apa adanya (latar, teks).
 * - `warna` saja: warna dasar → latar lembut + teks pekat diturunkan (`warnaChip`).
 * - tanpa keduanya: aksen tema.
 */
export function chip(
  ctx: DeckCtx,
  x: number,
  y: number,
  teks: string,
  opts: { warna?: string; teksWarna?: string; gelap?: boolean } = {},
): number {
  const { doc, tema } = ctx;
  const pasangan =
    opts.warna && opts.teksWarna
      ? { latar: opts.warna, teks: opts.teksWarna }
      : warnaChip(opts.warna ?? tema.palet.aksen, !!opts.gelap);
  doc.font(PDF_FONT.bold).fontSize(10);
  const t = s(teks);
  const w = doc.widthOfString(t) + 16;
  doc.roundedRect(x, y - 4, w, 20, tema.sudutKartu === 0 ? 2 : 10).fillColor(pasangan.latar).fill();
  doc.fillColor(pasangan.teks).text(t, x + 8, y, { lineBreak: false });
  return w;
}

/* ── Kartu angka ────────────────────────────────────────────────────────── */

export function kartuAngka(
  ctx: DeckCtx,
  items: { label: string; nilai: string; warna?: string }[],
  y: number,
  gelap: boolean,
): number {
  const { doc, tema } = ctx;
  const p = tema.palet;
  const gap = 14;
  const cw = (CW - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length);
  const ch = 72;
  items.forEach((it, i) => {
    const x = MX + i * (cw + gap);
    if (gelap) {
      doc.roundedRect(x, y, cw, ch, tema.sudutKartu).fillColor(p.gelapKartu).fill();
    } else {
      doc.roundedRect(x, y, cw, ch, tema.sudutKartu).fillColor(p.kartuTerang).fill();
      doc.roundedRect(x, y, cw, ch, tema.sudutKartu).lineWidth(0.8).strokeColor(p.garis).stroke();
    }
    doc.font(PDF_FONT.regular).fontSize(8.5).fillColor(warnaRedup(ctx, gelap)).text(s(it.label).toUpperCase(), x + 12, y + 12, {
      width: cw - 24,
      characterSpacing: 0.6,
    });
    doc.font(PDF_FONT.bold).fontSize(22).fillColor(it.warna ?? aksenTeks(ctx, gelap)).text(s(it.nilai), x + 12, y + 30, {
      width: cw - 24,
    });
  });
  return y + ch + 16;
}

/* ── Tabel ──────────────────────────────────────────────────────────────── */

export function tabel(
  ctx: DeckCtx,
  kolom: { label: string; w: number; align?: "left" | "right" }[],
  baris: string[][],
  y0: number,
  gelap: boolean,
): number {
  const { doc, tema } = ctx;
  const p = tema.palet;
  const rowH = 24;
  let y = y0;
  let x = MX;
  doc.roundedRect(MX, y, CW, rowH, Math.min(4, tema.sudutKartu)).fillColor(gelap ? p.gelapKartu : tur(ctx).aksenSoft).fill();
  doc.font(PDF_FONT.bold).fontSize(9.5).fillColor(aksenTeks(ctx, gelap));
  for (const kk of kolom) {
    doc.text(s(kk.label), x + 6, y + 7, { width: kk.w - 12, align: kk.align ?? "left", lineBreak: false });
    x += kk.w;
  }
  y += rowH;
  doc.font(PDF_FONT.regular).fontSize(9.5);
  const garis = warnaGaris(ctx, gelap);
  const teks = warnaTeks(ctx, gelap);
  for (const row of baris) {
    x = MX;
    doc.moveTo(MX, y + rowH).lineTo(MX + CW, y + rowH).lineWidth(0.5).strokeColor(garis).stroke();
    row.forEach((sel, i) => {
      const kk = kolom[i];
      if (!kk) return;
      doc.fillColor(teks);
      doc.text(potongTeks(ctx, sel, kk.w - 14), x + 6, y + 7, {
        width: kk.w - 12,
        align: kk.align ?? "left",
        lineBreak: false,
      });
      x += kk.w;
    });
    y += rowH;
  }
  return y + 10;
}

/* ── Daftar butir ───────────────────────────────────────────────────────── */

export function butirList(
  ctx: DeckCtx,
  items: string[],
  x: number,
  y: number,
  w: number,
  gelap: boolean,
  opts: { bernomor?: boolean; fontSize?: number; warna?: string } = {},
): number {
  const { doc, tema } = ctx;
  const fs = opts.fontSize ?? 12.5;
  const warna = opts.warna ?? warnaTeks(ctx, gelap);
  let yy = y;
  items.forEach((b, i) => {
    if (opts.bernomor) {
      doc.font(PDF_FONT.bold).fontSize(fs).fillColor(aksenTeks(ctx, gelap)).text(`${i + 1}.`, x, yy, { lineBreak: false });
      doc.font(PDF_FONT.regular).fontSize(fs).fillColor(warna);
      doc.text(s(b), x + 24, yy, { width: w - 24, lineGap: 2 });
    } else {
      doc.circle(x + 4, yy + fs / 2, 2.2).fillColor(tema.palet.aksen).fill();
      doc.font(PDF_FONT.regular).fontSize(fs).fillColor(warna);
      doc.text(s(b), x + 16, yy, { width: w - 16, lineGap: 2 });
    }
    yy = doc.y + 8;
  });
  return yy;
}

/* ── Sampul ─────────────────────────────────────────────────────────────── */

export type SampulDeck = {
  eyebrow: string;
  judul: string;
  subJudul: string | null;
  /** Item ber-`warna` digambar sebagai chip; sisanya "Label: nilai". */
  meta: { label: string; nilai: string; warna?: string }[];
  barisBawah: string[];
  draf: boolean;
};

/** Meta mendatar "Label: nilai | …" + chip; mengembalikan x akhir. */
function metaMendatar(
  ctx: DeckCtx,
  meta: SampulDeck["meta"],
  x0: number,
  y: number,
  gelap: boolean,
  warnaLabel: string,
  warnaNilai: string,
  warnaPemisah: string,
): number {
  const { doc } = ctx;
  let x = x0;
  meta.forEach((m, i) => {
    if (m.warna) {
      x += chip(ctx, x, y, s(`${m.label}: ${m.nilai}`), { warna: m.warna, gelap });
      if (i < meta.length - 1) x += 12;
      return;
    }
    doc.font(PDF_FONT.regular).fontSize(10.5).fillColor(warnaLabel).text(`${s(m.label)}: `, x, y, { lineBreak: false });
    x += doc.widthOfString(`${s(m.label)}: `);
    doc.font(PDF_FONT.bold).fontSize(10.5).fillColor(warnaNilai).text(s(m.nilai), x, y, { lineBreak: false });
    x += doc.widthOfString(s(m.nilai));
    if (i < meta.length - 1) {
      doc.font(PDF_FONT.regular).fillColor(warnaPemisah).text("   |   ", x, y, { lineBreak: false });
      x += doc.widthOfString("   |   ");
    }
  });
  return x;
}

/** Lebar meta mendatar tanpa menggambar (untuk merata-tengahkan). */
function lebarMetaMendatar(ctx: DeckCtx, meta: SampulDeck["meta"]): number {
  const { doc } = ctx;
  let w = 0;
  meta.forEach((m, i) => {
    if (m.warna) {
      doc.font(PDF_FONT.bold).fontSize(10);
      w += doc.widthOfString(s(`${m.label}: ${m.nilai}`)) + 16 + (i < meta.length - 1 ? 12 : 0);
      return;
    }
    doc.font(PDF_FONT.regular).fontSize(10.5);
    w += doc.widthOfString(`${s(m.label)}: `);
    doc.font(PDF_FONT.bold).fontSize(10.5);
    w += doc.widthOfString(s(m.nilai));
    if (i < meta.length - 1) {
      doc.font(PDF_FONT.regular);
      w += doc.widthOfString("   |   ");
    }
  });
  return w;
}

function sampulStripBawah(ctx: DeckCtx, sp: SampulDeck): void {
  const { doc, tema } = ctx;
  const t = tur(ctx);
  const p = tema.palet;
  latarSlide(ctx, true);
  const kiri = MX + 8;
  doc.font(PDF_FONT.bold).fontSize(11).fillColor(p.aksen).text(s(sp.eyebrow), kiri, 186, {
    characterSpacing: 2,
    width: CW - 8,
  });
  doc.font(PDF_FONT.bold).fontSize(34).fillColor(p.putih).text(s(sp.judul), kiri, doc.y + 14, {
    width: CW - 120,
    lineGap: 4,
  });
  if (sp.subJudul) {
    doc.font(PDF_FONT.regular).fontSize(13).fillColor(t.teksRedupGelap).text(s(sp.subJudul), kiri, doc.y + 6, {
      width: CW - 120,
    });
  }
  const yMeta = Math.max(doc.y + 26, 380);
  metaMendatar(ctx, sp.meta, kiri, yMeta, true, t.teksRedupGelap, p.putih, t.pemisahGelap);
  doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(t.teksSamarGelap).text(s(sp.barisBawah.join("  ·  ")), kiri, yMeta + 40, {
    width: CW - 8,
  });
}

function sampulBlokKiri(ctx: DeckCtx, sp: SampulDeck): void {
  const { doc, tema } = ctx;
  const t = tur(ctx);
  const p = tema.palet;
  const PW = Math.round(W * 0.38);
  doc.rect(0, 0, W, H).fillColor(p.terang).fill();
  doc.rect(0, 0, PW, H).fillColor(p.primer).fill();
  doc.rect(PW, 0, 4, H).fillColor(p.aksen).fill();

  // Panel kiri: eyebrow, meta bertumpuk, baris bawah.
  const px = 36;
  const pw = PW - px * 2;
  doc.font(PDF_FONT.bold).fontSize(10).fillColor(p.aksen).text(s(sp.eyebrow), px, 48, { characterSpacing: 1.5, width: pw });
  let y = 150;
  for (const m of sp.meta) {
    doc.font(PDF_FONT.regular).fontSize(8.5).fillColor(t.teksRedupGelap).text(s(m.label).toUpperCase(), px, y, {
      characterSpacing: 1,
      width: pw,
    });
    if (m.warna) {
      chip(ctx, px, doc.y + 8, s(m.nilai), { warna: m.warna, gelap: true });
      y = doc.y + 8 + 20 + 14;
    } else {
      doc.font(PDF_FONT.bold).fontSize(19).fillColor(p.putih).text(s(m.nilai), px, doc.y + 3, { width: pw });
      y = doc.y + 14;
    }
  }
  doc.font(PDF_FONT.regular).fontSize(8.5).fillColor(t.teksRedupGelap);
  let yb = H - 46 - sp.barisBawah.length * 13;
  for (const b of sp.barisBawah) {
    doc.text(potongTeks(ctx, b, pw), px, yb, { width: pw, lineBreak: false });
    yb += 13;
  }

  // Bidang kanan: judul besar.
  const kx = PW + 56;
  const kw = W - kx - MX;
  doc.rect(kx, 150, 46, 5).fillColor(p.aksen).fill();
  doc.font(PDF_FONT.bold).fontSize(32).fillColor(p.primer).text(s(sp.judul), kx, 172, { width: kw, lineGap: 4 });
  if (sp.subJudul) {
    doc.font(PDF_FONT.regular).fontSize(13).fillColor(p.inkMuted).text(s(sp.subJudul), kx, doc.y + 10, { width: kw });
  }
}

function sampulPitaAtas(ctx: DeckCtx, sp: SampulDeck): void {
  const { doc, tema } = ctx;
  const p = tema.palet;
  doc.rect(0, 0, W, H).fillColor(p.terang).fill();
  doc.rect(0, 0, W, 14).fillColor(p.aksen).fill();
  doc.rect(0, 14, W, 3).fillColor(p.primer).fill();

  doc.font(PDF_FONT.bold).fontSize(11).fillColor(p.aksenTua).text(s(sp.eyebrow), MX, 132, {
    characterSpacing: 2,
    width: CW,
    align: "center",
  });
  doc.font(PDF_FONT.bold).fontSize(36).fillColor(p.primer).text(s(sp.judul), MX + 40, doc.y + 18, {
    width: CW - 80,
    align: "center",
    lineGap: 4,
  });
  if (sp.subJudul) {
    doc.font(PDF_FONT.regular).fontSize(14).fillColor(p.inkMuted).text(s(sp.subJudul), MX, doc.y + 8, {
      width: CW,
      align: "center",
    });
  }
  const yMeta = Math.max(doc.y + 30, 372);
  const lebar = lebarMetaMendatar(ctx, sp.meta);
  metaMendatar(ctx, sp.meta, Math.max(MX, (W - lebar) / 2), yMeta, false, p.inkMuted, p.ink, p.inkFaint);

  // Pita primer bawah dengan baris kontrak.
  doc.rect(0, H - 96, W, 56).fillColor(p.primer).fill();
  doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(p.putih).text(s(sp.barisBawah.join("   ·   ")), MX, H - 96 + 22, {
    width: CW,
    align: "center",
    lineBreak: false,
  });
}

function sampulPusat(ctx: DeckCtx, sp: SampulDeck): void {
  const { doc, tema } = ctx;
  const p = tema.palet;
  doc.rect(0, 0, W, H).fillColor(p.terang).fill();
  // Bingkai ganda + pita dua warna di kepala bingkai.
  doc.rect(24, 24, W - 48, H - 48).lineWidth(2).strokeColor(p.primer).stroke();
  doc.rect(32, 32, W - 64, H - 64).lineWidth(0.8).strokeColor(p.aksen).stroke();
  doc.rect(24, 24, (W - 48) / 2, 10).fillColor(p.aksen).fill();
  doc.rect(24 + (W - 48) / 2, 24, (W - 48) / 2, 10).fillColor(p.primer).fill();

  doc.font(PDF_FONT.bold).fontSize(10.5).fillColor(p.aksen).text(s(sp.eyebrow), MX, 112, {
    characterSpacing: 2.5,
    width: CW,
    align: "center",
  });
  doc.font(PDF_FONT.bold).fontSize(34).fillColor(p.primer).text(s(sp.judul), MX + 30, doc.y + 16, {
    width: CW - 60,
    align: "center",
    lineGap: 4,
  });
  doc.rect(W / 2 - 30, doc.y + 10, 60, 3).fillColor(p.aksen).fill();
  if (sp.subJudul) {
    doc.font(PDF_FONT.regular).fontSize(13).fillColor(p.inkMuted).text(s(sp.subJudul), MX, doc.y + 20, {
      width: CW,
      align: "center",
    });
  }

  // Meta bertumpuk dua kolom: label rata kanan, nilai rata kiri.
  let y = Math.max(doc.y + 28, 330);
  const tengah = W / 2;
  for (const m of sp.meta) {
    doc.font(PDF_FONT.regular).fontSize(10).fillColor(p.inkMuted).text(s(m.label), tengah - 220, y + 1, {
      width: 210,
      align: "right",
      lineBreak: false,
    });
    if (m.warna) {
      chip(ctx, tengah + 10, y, s(m.nilai), { warna: m.warna, gelap: false });
    } else {
      doc.font(PDF_FONT.bold).fontSize(11).fillColor(p.ink).text(s(m.nilai), tengah + 10, y, { width: 300, lineBreak: false });
    }
    y += 22;
  }
  doc.font(PDF_FONT.regular).fontSize(9).fillColor(p.inkFaint).text(s(sp.barisBawah.join("  ·  ")), MX, H - 78, {
    width: CW,
    align: "center",
    lineBreak: false,
  });
}

/**
 * Sampul deck — empat bentuk yang berbeda TATA LETAKNYA, bukan cuma warnanya
 * (`tema.sampul`). Bila `draf`, watermark dibubuhkan di sini; pemanggil jangan
 * menumpuknya lagi di slide sampul.
 */
export function renderSampulDeck(ctx: DeckCtx, sp: SampulDeck): void {
  switch (ctx.tema.sampul) {
    case "strip_bawah":
      sampulStripBawah(ctx, sp);
      break;
    case "blok_kiri":
      sampulBlokKiri(ctx, sp);
      break;
    case "pita_atas":
      sampulPitaAtas(ctx, sp);
      break;
    case "pusat":
      sampulPusat(ctx, sp);
      break;
  }
  if (sp.draf) watermarkDraf(ctx, ctx.tema.sampul === "strip_bawah");
}

/* ── Penutup ────────────────────────────────────────────────────────────── */

/** Penutup; gelap ⇔ tema berselang. doc.y berakhir di bawah `sub`. */
export function renderPenutupDeck(ctx: DeckCtx, pn: { judul: string; sub: string }): void {
  const { doc, tema } = ctx;
  const p = tema.palet;
  const gelap = bingkaiGelap(tema);
  latarSlide(ctx, gelap);
  if (!gelap && tema.sampul === "pusat") {
    doc.rect(24, 24, W - 48, H - 48).lineWidth(2).strokeColor(p.primer).stroke();
    doc.rect(32, 32, W - 64, H - 64).lineWidth(0.8).strokeColor(p.aksen).stroke();
  }
  if (!gelap && tema.sampul === "pita_atas") {
    doc.rect(0, 0, W, 14).fillColor(p.aksen).fill();
    doc.rect(0, 14, W, 3).fillColor(p.primer).fill();
    doc.rect(0, H - 40, W, 40).fillColor(p.primer).fill();
  }
  doc.font(PDF_FONT.bold).fontSize(42).fillColor(gelap ? p.putih : p.primer).text(s(pn.judul), 0, H / 2 - 66, {
    width: W,
    align: "center",
  });
  doc.font(PDF_FONT.bold).fontSize(20).fillColor(gelap ? p.aksen : p.aksenTua).text(s(pn.sub), 0, doc.y + 10, {
    width: W,
    align: "center",
  });
}

/* ── Bar status berband ─────────────────────────────────────────────────── */

/**
 * Band warna bar status pekerjaan. AMBANGNYA bukan urusan primitif ini —
 * pemanggil yang memutuskan (`bandStatus` di `lib/paparan/susun.ts`); di sini
 * hanya pemetaan band → warna tema, supaya "kritis" berwarna sama di deck
 * paparan dan di deck laporan lengkap lokasi.
 */
export type BandBar = "tuntas" | "maju" | "sedang" | "kritis";

export function warnaBand(ctx: DeckCtx, band: BandBar): string {
  const p = ctx.tema.palet;
  switch (band) {
    case "tuntas":
      return p.aksenTua;
    case "maju":
      return p.biru;
    case "sedang":
      return p.oranye;
    case "kritis":
      return p.merah;
  }
}

/**
 * Satu baris bar status: label kiri (dipotong satu baris), nilai kanan
 * berwarna band, trek + isian di bawahnya, catatan kecil opsional.
 * Mengembalikan y baris berikutnya.
 */
export function barBand(
  ctx: DeckCtx,
  b: {
    x: number;
    y: number;
    w: number;
    label: string;
    nilai: string;
    /** Panjang isian bar (0..100) — angka jadi, bukan dihitung di sini. */
    pct: number;
    band: BandBar;
    catatan?: string | null;
  },
  gelap: boolean,
): number {
  const { doc, tema } = ctx;
  const warna = warnaBand(ctx, b.band);
  const sudut = Math.min(2.5, tema.sudutKartu);
  doc.font(PDF_FONT.regular).fontSize(11).fillColor(warnaTeks(ctx, gelap));
  doc.text(potongTeks(ctx, b.label, b.w - 78), b.x, b.y, { width: b.w - 74, lineBreak: false });
  doc.font(PDF_FONT.bold).fontSize(11).fillColor(warna).text(s(b.nilai), b.x, b.y, {
    width: b.w,
    align: "right",
    lineBreak: false,
  });
  const yb = b.y + 17;
  doc.roundedRect(b.x, yb, b.w, 5, sudut).fillColor(warnaTrekBar(ctx, gelap)).fill();
  if (b.pct > 0) {
    doc.roundedRect(b.x, yb, Math.max(4, (Math.min(b.pct, 100) / 100) * b.w), 5, sudut).fillColor(warna).fill();
  }
  if (b.catatan) {
    doc.font(PDF_FONT.regular).fontSize(8).fillColor(warnaSamar(ctx, gelap));
    doc.text(potongTeks(ctx, b.catatan, b.w), b.x, yb + 8, { width: b.w, lineBreak: false });
    return yb + 20;
  }
  return yb + 17;
}

/* ── Kartu bernomor ─────────────────────────────────────────────────────── */

/**
 * Daftar kartu bernomor bergaris kiri berwarna — bentuk yang sudah dipakai
 * Action Plan paparan, di sini sebagai primitif supaya deck lain memakai rupa
 * yang sama (mis. peringatan dini, warna per tingkat). Tinggi tiap kartu
 * mengikuti teksnya; mengembalikan y setelah kartu terakhir.
 */
export function kartuBernomor(
  ctx: DeckCtx,
  items: { judul?: string | null; teks: string; warna?: string }[],
  y0: number,
  gelap: boolean,
  opts: { x?: number; w?: number; fontSize?: number } = {},
): number {
  const { doc, tema } = ctx;
  const p = tema.palet;
  const x = opts.x ?? MX;
  const w = opts.w ?? CW;
  const fs = opts.fontSize ?? 11.5;
  const sudut = Math.min(8, tema.sudutKartu);
  let y = y0;
  items.forEach((it, i) => {
    const teksX = x + 62;
    const teksW = w - 76;
    doc.font(PDF_FONT.regular).fontSize(fs);
    const th = doc.heightOfString(s(it.teks), { width: teksW, lineGap: 2 });
    const jh = it.judul ? 14 : 0;
    const kh = Math.max(44, th + jh + 22);
    doc.roundedRect(x + 6, y, w - 6, kh, sudut).fillColor(gelap ? p.gelapKartu : p.putih).fill();
    if (!gelap) {
      doc.roundedRect(x + 6, y, w - 6, kh, sudut).lineWidth(0.6).strokeColor(p.garis).stroke();
    }
    const aksen = it.warna ?? p.aksen;
    doc.rect(x, y + 2, 4, kh - 4).fillColor(aksen).fill();
    doc.font(PDF_FONT.bold).fontSize(16).fillColor(aksen).text(`${i + 1 < 10 ? "0" : ""}${i + 1}`, x + 22, y + kh / 2 - 10, {
      lineBreak: false,
    });
    let ty = y + (kh - th - jh) / 2;
    if (it.judul) {
      doc.font(PDF_FONT.bold).fontSize(9.5).fillColor(aksen);
      doc.text(potongTeks(ctx, it.judul, teksW), teksX, ty, { width: teksW, lineBreak: false });
      ty += jh;
    }
    doc.font(PDF_FONT.regular).fontSize(fs).fillColor(warnaTeks(ctx, gelap)).text(s(it.teks), teksX, ty, {
      width: teksW,
      lineGap: 2,
    });
    y += kh + 12;
  });
  return y;
}

/* ── Kurva-S ────────────────────────────────────────────────────────────── */

export type KurvaDeck = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rencana kumulatif % per minggu (index 0 = minggu 1). */
  planPct: number[];
  /** Realisasi kumulatif per minggu; null = belum ada/tak dihitung. */
  actualPct: (number | null)[];
  /** 1-based; di luar 1..N = tanpa penanda. */
  mingguSekarang: number;
  labelRencana?: string;
  labelRealisasi?: string;
};

/**
 * Grafik garis rencana (putus-putus) vs realisasi (tebal, aksen) dengan kisi,
 * label sumbu, penanda minggu sekarang, dan label nilai realisasi terakhir.
 * Label sumbu Y ditulis di k.x−30 (sisakan ±34pt kiri), label X di
 * k.y+k.h+6, legenda/penanda di k.y−14.
 */
export function gambarKurva(ctx: DeckCtx, k: KurvaDeck, gelap: boolean): void {
  const { doc, tema } = ctx;
  const t = tur(ctx);
  const p = tema.palet;
  const N = Math.max(k.planPct.length, k.actualPct.length);
  const gx = k.x;
  const gy = k.y;
  const gw = k.w;
  const gh = k.h;
  const xDari = (minggu: number) => gx + ((minggu - 1) / Math.max(1, N - 1)) * gw;
  const yDari = (pct: number) => gy + gh - (Math.min(Math.max(pct, 0), 100) / 100) * gh;
  const samar = warnaSamar(ctx, gelap);
  const kisi = gelap ? t.garisGelap : p.garis;

  // Kisi + label sumbu Y.
  doc.font(PDF_FONT.regular).fontSize(7.5).fillColor(samar);
  for (let pp = 0; pp <= 100; pp += 20) {
    const yy = yDari(pp);
    doc.moveTo(gx, yy).lineTo(gx + gw, yy).lineWidth(0.5).strokeColor(kisi).stroke();
    doc.fillColor(samar).text(`${pp}%`, gx - 30, yy - 4, { width: 26, align: "right", lineBreak: false });
  }
  // Label sumbu X (maks ~12 label supaya tidak bertumpuk).
  if (N > 0) {
    const langkah = Math.max(1, Math.ceil(N / 12));
    for (let m = 1; m <= N; m += langkah) {
      doc.fillColor(samar).text(`Mgg ${m}`, xDari(m) - 16, gy + gh + 6, { width: 34, align: "center", lineBreak: false });
    }
  }

  // Legenda (hanya bila diminta).
  if (k.labelRencana || k.labelRealisasi) {
    let lx = gx + gw - 230;
    const ly = gy - 14;
    doc.font(PDF_FONT.regular).fontSize(8);
    if (k.labelRencana) {
      doc.save();
      doc.dash(4, { space: 3 });
      doc.moveTo(lx, ly + 4).lineTo(lx + 22, ly + 4).lineWidth(1.4).strokeColor(gelap ? t.teksSamarGelap : t.garisRencana).stroke();
      doc.undash();
      doc.restore();
      doc.fillColor(warnaRedup(ctx, gelap)).text(s(k.labelRencana), lx + 28, ly, { lineBreak: false });
      lx += 28 + doc.widthOfString(s(k.labelRencana)) + 18;
    }
    if (k.labelRealisasi) {
      doc.moveTo(lx, ly + 4).lineTo(lx + 22, ly + 4).lineWidth(2).strokeColor(p.aksen).stroke();
      doc.fillColor(warnaRedup(ctx, gelap)).text(s(k.labelRealisasi), lx + 28, ly, { lineBreak: false });
    }
  }

  // Garis RENCANA putus-putus sepanjang kontrak.
  if (k.planPct.length > 0) {
    doc.save();
    doc.dash(4, { space: 3 });
    doc.lineWidth(1.4).strokeColor(gelap ? t.teksSamarGelap : t.garisRencana);
    k.planPct.forEach((pp, i) => {
      const x = xDari(i + 1);
      const y = yDari(pp);
      if (i === 0) doc.moveTo(x, y);
      else doc.lineTo(x, y);
    });
    doc.stroke();
    doc.undash();
    doc.restore();
  }

  // REALISASI: tiap deret bersambung (null memutus) — isian lembut + garis tebal + titik.
  const runs: { minggu: number; pct: number }[][] = [];
  let run: { minggu: number; pct: number }[] = [];
  k.actualPct.forEach((v, i) => {
    if (v == null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push({ minggu: i + 1, pct: v });
  });
  if (run.length > 0) runs.push(run);
  for (const r of runs) {
    const first = r[0];
    const last = r[r.length - 1];
    if (r.length > 1) {
      doc.save();
      doc.moveTo(xDari(first.minggu), yDari(first.pct));
      for (const q of r.slice(1)) doc.lineTo(xDari(q.minggu), yDari(q.pct));
      doc.lineTo(xDari(last.minggu), gy + gh).lineTo(xDari(first.minggu), gy + gh).closePath();
      doc.fillColor(p.aksen).opacity(0.08).fill();
      doc.opacity(1);
      doc.restore();
      doc.lineWidth(2).strokeColor(p.aksen);
      r.forEach((q, i) => {
        const x = xDari(q.minggu);
        const y = yDari(q.pct);
        if (i === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      });
      doc.stroke();
    }
    for (const q of r) doc.circle(xDari(q.minggu), yDari(q.pct), 3).fillColor(p.aksen).fill();
  }

  // Penanda "Minggu Ini".
  if (k.mingguSekarang >= 1 && k.mingguSekarang <= N) {
    const xIni = xDari(k.mingguSekarang);
    doc.moveTo(xIni, gy).lineTo(xIni, gy + gh).lineWidth(0.8).strokeColor(gelap ? t.garisGelap : t.garisPenanda).stroke();
    doc.font(PDF_FONT.bold).fontSize(8.5).fillColor(p.aksen).text("Minggu Ini", xIni - 24, gy - 12, {
      width: 60,
      lineBreak: false,
    });
  }

  // Label nilai realisasi terakhir.
  const terakhir = runs.length > 0 ? runs[runs.length - 1][runs[runs.length - 1].length - 1] : null;
  if (terakhir) {
    const xL = xDari(terakhir.minggu);
    const yL = yDari(terakhir.pct);
    doc.font(PDF_FONT.bold).fontSize(11).fillColor(warnaTeks(ctx, gelap)).text(pctLabel(terakhir.pct), xL - 60, yL - 18, {
      width: 56,
      align: "right",
      lineBreak: false,
    });
  }
}
