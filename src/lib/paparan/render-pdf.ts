import "server-only";
import sharp from "sharp";
import { isR2Configured, r2GetBuffer } from "@/lib/r2";
import {
  DECK_169,
  PDF_FONT,
  createDeck169Doc,
  docToBuffer,
  sanitizeText,
  type PdfDoc,
} from "@/lib/pdf/document";
import { formatRupiah } from "@/lib/format";
import type { PaparanContent } from "./jenis";
import { bandStatus, judulPaparan, pctID, ppID, susunSlides, type Slide } from "./susun";

/**
 * RENDERER PDF PAPARAN 16:9 (DECISIONS 416/417) — mengikuti contoh paparan
 * Mataram dari user: slide gelap/terang berselang, aksen cyan, kurva-S,
 * durasi pelaksanaan, bar status per pekerjaan, foto per pekerjaan dengan
 * kepala nama + persen, Action Plan bernomor, penutup "Terima Kasih".
 *
 * Membaca structured content kanonik yang SAMA dengan preview web; tidak ada
 * angka dihitung ulang. Draft ber-watermark di setiap slide.
 */

const W = DECK_169.width;
const H = DECK_169.height;
const MX = 52;
const CW = W - MX * 2;

/** Palet gaya contoh Mataram — gelap navy + aksen cyan. */
const C = {
  gelap: "#0e1726",
  gelapKartu: "#162032",
  cyan: "#0ec1ce",
  cyanTua: "#0a9aa5",
  putih: "#ffffff",
  terang: "#f4f6f9",
  ink: "#1f2937",
  inkMuted: "#5b6472",
  inkFaint: "#9aa3af",
  garis: "#e3e7ee",
  hijau: "#16a34a",
  hijauSoft: "#e7f6ec",
  biru: "#3b82f6",
  oranye: "#f59e0b",
  merah: "#e11d48",
  merahSoft: "#fde7ec",
  kartuTerang: "#ffffff",
} as const;

const WARNA_BAND: Record<ReturnType<typeof bandStatus>, string> = {
  tuntas: C.cyanTua,
  maju: C.biru,
  sedang: C.oranye,
  kritis: C.merah,
};

function s(t: string): string {
  return sanitizeText(t);
}

/**
 * Potong teks agar muat SATU baris selebar `maxW` pada font/ukuran aktif.
 * `ellipsis` pdfkit tidak bisa diandalkan tanpa batas tinggi (nama kategori
 * panjang tetap turun baris dan tertindih bar — ketahuan dari PNG hasil
 * render); pemotongan manual berbasis `widthOfString` deterministik.
 */
function potong(doc: PdfDoc, teks: string, maxW: number): string {
  const t = s(teks);
  if (doc.widthOfString(t) <= maxW) return t;
  let n = t.length;
  while (n > 1 && doc.widthOfString(`${t.slice(0, n)}…`) > maxW) n -= 1;
  return `${t.slice(0, n).trimEnd()}…`;
}

/* ── Kerangka ───────────────────────────────────────────────────────────── */

function latarGelap(doc: PdfDoc): void {
  doc.rect(0, 0, W, H).fillColor(C.gelap).fill();
  // Aksen: bilah cyan tipis di tepi kiri + lingkaran dekoratif samar kanan.
  doc.rect(0, 0, 5, H).fillColor(C.cyan).fill();
  doc.save();
  doc.lineWidth(1).strokeColor("#233049");
  doc.circle(W - 90, 170, 150).stroke();
  doc.circle(W - 90, 170, 95).stroke();
  doc.restore();
}

function latarTerang(doc: PdfDoc): void {
  doc.rect(0, 0, W, H).fillColor(C.terang).fill();
}

/** Judul slide terang: teks tebal gelap + garis cyan (pola contoh). */
function judulTerang(doc: PdfDoc, teks: string): number {
  doc.font(PDF_FONT.bold).fontSize(21).fillColor(C.ink).text(s(teks), MX, 42, { width: CW });
  const y = doc.y + 8;
  doc.moveTo(MX, y).lineTo(MX + CW, y).lineWidth(1.6).strokeColor(C.cyan).stroke();
  return y + 18;
}

/** Judul slide gelap. */
function judulGelap(doc: PdfDoc, teks: string): number {
  doc.font(PDF_FONT.bold).fontSize(21).fillColor(C.putih).text(s(teks), MX, 60, { width: CW });
  const y = doc.y + 8;
  doc.moveTo(MX, y).lineTo(MX + CW, y).lineWidth(1.6).strokeColor(C.cyan).stroke();
  return y + 20;
}

function footer(doc: PdfDoc, kiri: string, nomor: number, total: number, gelap: boolean): void {
  const y = H - 22;
  doc.font(PDF_FONT.regular).fontSize(7.5).fillColor(gelap ? "#41506b" : C.inkFaint);
  doc.text(s(kiri), MX, y, { width: CW - 80, lineBreak: false });
  doc.text(`${nomor}/${total}`, MX, y, { width: CW, align: "right", lineBreak: false });
}

function watermarkDraf(doc: PdfDoc, gelap: boolean): void {
  doc.save();
  doc.font(PDF_FONT.bold).fontSize(44).fillColor(gelap ? "#f87171" : "#dc2626").opacity(gelap ? 0.18 : 0.12);
  doc.rotate(-18, { origin: [W / 2, H / 2] });
  doc.text("DRAF – BELUM DISETUJUI", 0, H / 2 - 28, { width: W, align: "center" });
  doc.restore();
  doc.opacity(1);
}

function chip(
  doc: PdfDoc,
  teks: string,
  x: number,
  y: number,
  warnaTeks: string,
  warnaLatar: string,
): number {
  doc.font(PDF_FONT.bold).fontSize(10);
  const w = doc.widthOfString(teks) + 16;
  doc.roundedRect(x, y - 4, w, 20, 10).fillColor(warnaLatar).fill();
  doc.fillColor(warnaTeks).text(teks, x + 8, y, { lineBreak: false });
  return w;
}

/* ── Foto ───────────────────────────────────────────────────────────────── */

/**
 * Ambil + normalisasi foto sebagai DATA URI base64, bukan Buffer.
 *
 * PENTING: bundle pdfkit self-contained yang di-vendor MENSTUB `fs`, jadi
 * `doc.image(Buffer)` gagal di standalone produksi dengan "fs.readFileSync is
 * not a function" — persis jebakan DECISIONS 129 yang sudah dihadapi renderer
 * kegiatan. Data URI di-decode inline tanpa menyentuh fs.
 *
 * Ukuran 1400×900: sisi foto pada slide dua-kolom ±417pt, jadi ini ≈3,4×
 * ukuran cetak — cukup tajam saat deck diproyeksikan maupun dicetak. Yang
 * sebelumnya 760px tampak pecah di layar besar.
 */
async function ambilFoto(r2Key: string): Promise<string | null> {
  if (!isR2Configured()) return null;
  try {
    const raw = await r2GetBuffer(r2Key);
    const jpeg = await sharp(raw)
      .rotate()
      .resize(1400, 900, { fit: "cover", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

/* ── Slide: sampul ──────────────────────────────────────────────────────── */

function renderSampul(doc: PdfDoc, sl: Extract<Slide, { jenis: "sampul" }>): void {
  latarGelap(doc);
  const kiri = MX + 8;
  doc.font(PDF_FONT.bold).fontSize(11).fillColor(C.cyan).text(
    s(`PAPARAN MINGGUAN  ·  MINGGU KE-${sl.mingguKe}${sl.berjalan ? "  ·  BELUM GENAP" : ""}`),
    kiri,
    186,
    { characterSpacing: 2, width: CW - 8 },
  );
  doc.font(PDF_FONT.bold).fontSize(34).fillColor(C.putih).text(s(sl.judulKerja), kiri, doc.y + 14, {
    width: CW - 120,
    lineGap: 4,
  });
  if (sl.subJudul) {
    doc.font(PDF_FONT.regular).fontSize(13).fillColor("#8fa0bb").text(s(sl.subJudul), kiri, doc.y + 6, {
      width: CW - 120,
    });
  }

  // Meta strip: Periode | Realisasi | Rencana | chip Deviasi (pola contoh).
  const yMeta = Math.max(doc.y + 26, 380);
  let x = kiri;
  const tulisMeta = (label: string, nilai: string) => {
    doc.font(PDF_FONT.regular).fontSize(10.5).fillColor("#8fa0bb").text(`${label}: `, x, yMeta, { lineBreak: false });
    x += doc.widthOfString(`${label}: `);
    doc.font(PDF_FONT.bold).fontSize(10.5).fillColor(C.putih).text(nilai, x, yMeta, { lineBreak: false });
    x += doc.widthOfString(nilai);
    doc.font(PDF_FONT.regular).fillColor("#3d4c66").text("   |   ", x, yMeta, { lineBreak: false });
    x += doc.widthOfString("   |   ");
  };
  tulisMeta("Periode", sl.periodeLabel);
  tulisMeta("Realisasi", pctID(sl.meta.realisasiPct));
  tulisMeta("Rencana", pctID(sl.meta.rencanaPct));
  const dev = sl.meta.deviasiPp;
  chip(
    doc,
    s(`Deviasi: ${ppID(dev)}`),
    x,
    yMeta,
    dev != null && dev < 0 ? "#ff8aa5" : "#6ee7b7",
    dev != null && dev < 0 ? "#3a1b2b" : "#12352b",
  );

  doc.font(PDF_FONT.regular).fontSize(9.5).fillColor("#61708c").text(
    s(`${sl.instansi}  ·  ${sl.nomorKontrak}  ·  ${sl.pelaksana}`),
    kiri,
    yMeta + 40,
    { width: CW - 8 },
  );
}

/* ── Slide: kurva-S ─────────────────────────────────────────────────────── */

function renderKurva(doc: PdfDoc, sl: Extract<Slide, { jenis: "kurva" }>): void {
  latarTerang(doc);
  const y0 = judulTerang(doc, "Diagram Progres S-Curve");
  const k = sl.kurva;

  // Bidang grafik.
  const gx = MX + 34;
  const gy = y0 + 8;
  const gw = CW - 44;
  const gh = H - gy - 118;
  const xDari = (minggu: number) =>
    gx + ((minggu - 1) / Math.max(1, k.totalMinggu - 1)) * gw;
  const yDari = (pct: number) => gy + gh - (Math.min(pct, 100) / 100) * gh;

  // Kisi + label sumbu Y.
  doc.font(PDF_FONT.regular).fontSize(7.5).fillColor(C.inkFaint);
  for (let p = 0; p <= 100; p += 20) {
    const yy = yDari(p);
    doc.moveTo(gx, yy).lineTo(gx + gw, yy).lineWidth(0.5).strokeColor(C.garis).stroke();
    doc.fillColor(C.inkFaint).text(`${p}%`, gx - 30, yy - 4, { width: 26, align: "right", lineBreak: false });
  }
  // Label sumbu X (maks ~12 label supaya tidak bertumpuk).
  const langkah = Math.max(1, Math.ceil(k.totalMinggu / 12));
  for (let m = 1; m <= k.totalMinggu; m += langkah) {
    doc.fillColor(C.inkFaint).text(`Mgg ${m}`, xDari(m) - 16, gy + gh + 6, { width: 34, align: "center", lineBreak: false });
  }

  // Garis RENCANA putus-putus abu sepanjang kontrak (pola contoh).
  doc.save();
  doc.dash(4, { space: 3 });
  doc.lineWidth(1.4).strokeColor("#b9c1cc");
  k.planPct.forEach((p, i) => {
    const x = xDari(i + 1);
    const y = yDari(p);
    if (i === 0) doc.moveTo(x, y);
    else doc.lineTo(x, y);
  });
  doc.stroke();
  doc.undash();
  doc.restore();

  // Jendela REALISASI cyan + isian lembut di bawahnya.
  if (k.jendela.length > 0) {
    const first = k.jendela[0];
    const last = k.jendela[k.jendela.length - 1];
    doc.save();
    doc
      .moveTo(xDari(first.minggu), yDari(first.realisasiPct));
    for (const t of k.jendela.slice(1)) doc.lineTo(xDari(t.minggu), yDari(t.realisasiPct));
    doc.lineTo(xDari(last.minggu), gy + gh).lineTo(xDari(first.minggu), gy + gh).closePath();
    doc.fillColor("#0ec1ce").opacity(0.08).fill();
    doc.opacity(1);
    doc.restore();

    doc.lineWidth(2).strokeColor(C.cyan);
    k.jendela.forEach((t, i) => {
      const x = xDari(t.minggu);
      const y = yDari(t.realisasiPct);
      if (i === 0) doc.moveTo(x, y);
      else doc.lineTo(x, y);
    });
    doc.stroke();
    for (const t of k.jendela) {
      doc.circle(xDari(t.minggu), yDari(t.realisasiPct), 3).fillColor(C.cyan).fill();
    }

    // Penanda "Minggu Ini" + label nilai + chip deviasi.
    const xIni = xDari(last.minggu);
    doc.moveTo(xIni, gy).lineTo(xIni, gy + gh).lineWidth(0.8).strokeColor("#bfeef1").stroke();
    doc.font(PDF_FONT.bold).fontSize(8.5).fillColor(C.cyan).text("Minggu Ini", xIni - 24, gy - 12, {
      width: 60,
      lineBreak: false,
    });
    const yLast = yDari(last.realisasiPct);
    doc.font(PDF_FONT.bold).fontSize(11).fillColor(C.ink).text(pctID(last.realisasiPct), xIni - 60, yLast - 18, {
      width: 56,
      align: "right",
      lineBreak: false,
    });
    if (sl.deviasiPp != null) {
      chip(
        doc,
        s(ppID(sl.deviasiPp).replace(" pp", "%")),
        xIni + 10,
        yLast - 6,
        sl.deviasiPp < 0 ? C.merah : C.hijau,
        sl.deviasiPp < 0 ? C.merahSoft : C.hijauSoft,
      );
    }
  }

  // Baris statistik 3 minggu terakhir (pola contoh: nilai + chip kenaikan).
  const ys = gy + gh + 26;
  const selW = CW / Math.max(1, k.jendela.length);
  doc.moveTo(MX, ys - 6).lineTo(MX + CW, ys - 6).lineWidth(0.6).strokeColor(C.garis).stroke();
  k.jendela.forEach((t, i) => {
    const x = MX + i * selW + 10;
    const terakhir = i === k.jendela.length - 1;
    if (terakhir) {
      doc.roundedRect(MX + i * selW, ys - 12, selW - 4, 34, 6).fillColor("#eafafb").fill();
    }
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(C.inkMuted).text(`Minggu ${t.minggu}`, x, ys, { lineBreak: false });
    let xv = x + doc.widthOfString(`Minggu ${t.minggu}`) + 10;
    doc.font(PDF_FONT.bold).fontSize(12).fillColor(C.ink).text(pctID(t.realisasiPct), xv, ys - 2, { lineBreak: false });
    xv += doc.widthOfString(pctID(t.realisasiPct)) + 8;
    if (t.kenaikanPp != null) {
      chip(
        doc,
        s(`${t.kenaikanPp >= 0 ? "+" : ""}${t.kenaikanPp.toFixed(2).replace(".", ",")}%`),
        xv,
        ys,
        t.kenaikanPp >= 0 ? C.hijau : C.merah,
        t.kenaikanPp >= 0 ? C.hijauSoft : C.merahSoft,
      );
    }
  });
}

/* ── Slide: durasi (gelap, tiga kartu) ──────────────────────────────────── */

function renderDurasi(doc: PdfDoc, sl: Extract<Slide, { jenis: "durasi" }>): void {
  latarGelap(doc);
  const y0 = judulGelap(doc, "Durasi Pelaksanaan");
  const d = sl.d;
  const kartu: { nilai: number; label: string; sorot: boolean }[] = [
    { nilai: d.totalHari, label: "TOTAL HARI", sorot: false },
    { nilai: d.hariBerjalan, label: "HARI BERJALAN", sorot: false },
    { nilai: d.sisaHari, label: "SISA WAKTU", sorot: true },
  ];
  const kw = 200;
  const kh = 128;
  const gap = 24;
  const x0 = (W - (kw * 3 + gap * 2)) / 2;
  const yk = y0 + 36;
  kartu.forEach((krt, i) => {
    const x = x0 + i * (kw + gap);
    doc.roundedRect(x, yk, kw, kh, 10).fillColor(krt.sorot ? C.cyan : C.gelapKartu).fill();
    doc.font(PDF_FONT.bold).fontSize(44).fillColor(C.putih).text(String(krt.nilai), x, yk + 24, {
      width: kw,
      align: "center",
    });
    doc.font(PDF_FONT.bold).fontSize(10).fillColor(krt.sorot ? "#e6fbfc" : "#8fa0bb").text(krt.label, x, yk + 86, {
      width: kw,
      align: "center",
      characterSpacing: 2,
    });
  });

  // Bar % waktu berjalan.
  const bw = kw * 3 + gap * 2;
  const yb = yk + kh + 36;
  doc.roundedRect(x0, yb, bw, 8, 4).fillColor(C.gelapKartu).fill();
  doc.roundedRect(x0, yb, Math.max(8, (Math.min(d.pctWaktu, 100) / 100) * bw), 8, 4).fillColor(C.cyan).fill();
  doc.font(PDF_FONT.regular).fontSize(9.5).fillColor("#8fa0bb");
  doc.text("Mulai", x0, yb + 16, { lineBreak: false });
  doc.text("Selesai", x0, yb + 16, { width: bw, align: "right", lineBreak: false });
  doc.font(PDF_FONT.bold).fillColor(C.cyan).text(
    s(`${d.pctWaktu.toFixed(2).replace(".", ",")}% waktu telah berjalan`),
    x0,
    yb + 16,
    { width: bw, align: "center", lineBreak: false },
  );
}

/* ── Slide: status pekerjaan per kategori (bar dua kolom) ───────────────── */

function renderStatusKategori(doc: PdfDoc, sl: Extract<Slide, { jenis: "status_kategori" }>): void {
  latarTerang(doc);
  const judul = sl.lokasiNama ? `Status Pekerjaan – ${sl.lokasiNama}` : "Status Pekerjaan";
  const y0 = judulTerang(doc, sl.totalBagian > 1 ? `${judul} (${sl.bagian}/${sl.totalBagian})` : judul);
  const kolW = (CW - 48) / 2;
  const tiapKol = Math.ceil(sl.baris.length / 2);
  sl.baris.forEach((b, i) => {
    const kol = Math.floor(i / tiapKol);
    const x = MX + kol * (kolW + 48);
    const y = y0 + (i % tiapKol) * 46;
    const warna = WARNA_BAND[bandStatus(b.realisasiPct)];
    doc.font(PDF_FONT.regular).fontSize(11).fillColor(C.ink);
    doc.text(potong(doc, b.nama, kolW - 74), x, y, { width: kolW - 70, lineBreak: false });
    doc.font(PDF_FONT.bold).fontSize(11).fillColor(warna).text(pctID(b.realisasiPct), x, y, {
      width: kolW,
      align: "right",
      lineBreak: false,
    });
    const yb = y + 17;
    doc.roundedRect(x, yb, kolW, 5, 2.5).fillColor("#dde2ea").fill();
    if (b.realisasiPct > 0) {
      doc.roundedRect(x, yb, Math.max(4, (Math.min(b.realisasiPct, 100) / 100) * kolW), 5, 2.5).fillColor(warna).fill();
    }
  });
}

/* ── Slide: foto per pekerjaan (kepala gelap + dua foto) ────────────────── */

async function renderFotoPekerjaan(
  doc: PdfDoc,
  sl: Extract<Slide, { jenis: "foto_pekerjaan" }>,
  gambar: Map<string, string | null>,
): Promise<void> {
  latarGelap(doc);
  // Kepala: nama pekerjaan kiri, persen cyan besar kanan (pola contoh).
  doc.font(PDF_FONT.bold).fontSize(18).fillColor(C.putih);
  doc.text(potong(doc, sl.judul, CW - 146), MX, 30, { width: CW - 140, lineBreak: false });
  if (sl.pct != null) {
    doc.font(PDF_FONT.bold).fontSize(20).fillColor(C.cyan).text(pctID(sl.pct), MX, 28, {
      width: CW,
      align: "right",
      lineBreak: false,
    });
  }
  doc.moveTo(0, 66).lineTo(W, 66).lineWidth(0.8).strokeColor("#233049").stroke();

  // Pita tengah putih tempat foto duduk (pola contoh: band terang di tengah).
  const py = 96;
  const ph = H - py - 78;
  doc.rect(0, py, W, ph).fillColor(C.putih).fill();

  const n = sl.foto.length;
  const gap = 22;
  const fw = n === 1 ? Math.min(CW, 620) : (CW - gap) / 2;
  const fh = ph - 58;
  const x0 = n === 1 ? (W - fw) / 2 : MX;
  sl.foto.forEach((f, i) => {
    const x = x0 + i * (fw + gap);
    const y = py + 18;
    const buf = gambar.get(f.id) ?? null;
    if (buf) {
      doc.save();
      doc.roundedRect(x, y, fw, fh, 8).clip();
      doc.image(buf, x, y, { cover: [fw, fh], align: "center", valign: "center" } as never);
      doc.restore();
      doc.roundedRect(x, y, fw, fh, 8).lineWidth(1).strokeColor("#e3e7ee").stroke();
    } else {
      doc.roundedRect(x, y, fw, fh, 8).fillColor("#eef1f5").fill();
      doc.font(PDF_FONT.regular).fontSize(10).fillColor(C.inkMuted).text("Foto tidak dapat dimuat", x, y + fh / 2 - 6, {
        width: fw,
        align: "center",
      });
    }
    /*
     * Keterangan foto dibaca dari layar proyektor, bukan dari layar laptop:
     * abu-abu tipis 8.5pt hilang di ruangan terang. Tebal + tinta gelap, plus
     * garis aksen cyan pendek supaya matanya tahu di mana mulai membaca.
     */
    const cy = y + fh + 8;
    doc.rect(x, cy + 2, 3, 11).fillColor(C.cyan).fill();
    doc.font(PDF_FONT.bold).fontSize(9).fillColor(C.ink);
    // DUA baris, bukan satu: keterangan lengkap sering lebih panjang dari
    // separuh slide ("Pekerjaan Sondir termasuk Pelaporan termasuk mobilisasi
    // Alat dan Personil"), dan dipotong satu baris ia kehilangan justru bagian
    // yang membedakan satu foto dari foto sebelahnya.
    doc.text(s(f.caption), x + 8, cy, { width: fw - 8, height: 23, ellipsis: true } as never);
  });
}

/* ── Slide-slide terang berbasis daftar/tabel ───────────────────────────── */

function butirList(
  doc: PdfDoc,
  butir: string[],
  y0: number,
  opts?: { fontSize?: number; warna?: string },
): number {
  const fs = opts?.fontSize ?? 12.5;
  let y = y0;
  for (const b of butir) {
    doc.circle(MX + 4, y + fs / 2, 2.2).fillColor(C.cyan).fill();
    doc.font(PDF_FONT.regular).fontSize(fs).fillColor(opts?.warna ?? C.ink);
    doc.text(s(b), MX + 16, y, { width: CW - 16, lineGap: 2 });
    y = doc.y + 8;
  }
  return y;
}

type Kolom = { label: string; w: number; align?: "left" | "right" };

function tabel(doc: PdfDoc, kolom: Kolom[], baris: string[][], y0: number): number {
  const rowH = 24;
  let y = y0;
  let x = MX;
  doc.roundedRect(MX, y, CW, rowH, 4).fillColor("#e8f7f8").fill();
  doc.font(PDF_FONT.bold).fontSize(9.5).fillColor(C.cyanTua);
  for (const kk of kolom) {
    doc.text(s(kk.label), x + 6, y + 7, { width: kk.w - 12, align: kk.align ?? "left", lineBreak: false });
    x += kk.w;
  }
  y += rowH;
  doc.font(PDF_FONT.regular).fontSize(9.5);
  for (const row of baris) {
    x = MX;
    doc.moveTo(MX, y + rowH).lineTo(MX + CW, y + rowH).lineWidth(0.5).strokeColor(C.garis).stroke();
    row.forEach((sel, i) => {
      const kk = kolom[i];
      doc.fillColor(C.ink);
      doc.text(potong(doc, sel, kk.w - 14), x + 6, y + 7, {
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

function kartuAngka(doc: PdfDoc, items: { label: string; nilai: string; warna?: string }[], y: number): number {
  const gap = 14;
  const cw = (CW - gap * (items.length - 1)) / items.length;
  const ch = 72;
  items.forEach((it, i) => {
    const x = MX + i * (cw + gap);
    doc.roundedRect(x, y, cw, ch, 8).fillColor(C.kartuTerang).fill();
    doc.roundedRect(x, y, cw, ch, 8).lineWidth(0.8).strokeColor(C.garis).stroke();
    doc.font(PDF_FONT.regular).fontSize(8.5).fillColor(C.inkMuted).text(s(it.label).toUpperCase(), x + 12, y + 12, {
      width: cw - 24,
      characterSpacing: 0.6,
    });
    doc.font(PDF_FONT.bold).fontSize(22).fillColor(it.warna ?? C.cyanTua).text(s(it.nilai), x + 12, y + 30, {
      width: cw - 24,
    });
  });
  return y + ch + 16;
}

function renderRingkasan(doc: PdfDoc, sl: Extract<Slide, { jenis: "ringkasan" }>): void {
  latarTerang(doc);
  let y = judulTerang(doc, "Ringkasan Eksekutif");
  y = kartuAngka(
    doc,
    [
      { label: "Rencana", nilai: pctID(sl.angka.rencana), warna: C.ink },
      { label: "Realisasi", nilai: pctID(sl.angka.realisasi) },
      {
        label: "Deviasi",
        nilai: ppID(sl.angka.deviasi),
        warna: sl.angka.deviasi != null && sl.angka.deviasi < 0 ? C.merah : C.hijau,
      },
      { label: "Laporan final", nilai: `${sl.angka.laporanFinal}/${sl.angka.laporanDiharapkan}`, warna: C.ink },
    ],
    y,
  );
  butirList(doc, sl.butir, y + 4);
}

function renderProgresLokasi(doc: PdfDoc, sl: Extract<Slide, { jenis: "progres_lokasi" }>): void {
  latarTerang(doc);
  const y = judulTerang(
    doc,
    sl.totalBagian > 1 ? `Progres per Lokasi (${sl.bagian}/${sl.totalBagian})` : "Progres per Lokasi",
  );
  tabel(
    doc,
    [
      { label: "Lokasi", w: CW - 120 * 4 },
      { label: "Rencana", w: 120, align: "right" },
      { label: "Realisasi", w: 120, align: "right" },
      { label: "Deviasi", w: 120, align: "right" },
      { label: "Status data", w: 120 },
    ],
    sl.baris.map((b) => [
      b.name,
      b.targetPct == null ? "–" : pctID(b.targetPct),
      pctID(b.realisasiPct),
      b.deviasiPp == null ? "–" : ppID(b.deviasiPp),
      b.targetPct == null ? "belum ada kurva-S" : "lengkap",
    ]),
    y,
  );
}

function renderCapaian(doc: PdfDoc, sl: Extract<Slide, { jenis: "capaian" }>): void {
  latarTerang(doc);
  let y = judulTerang(doc, "Capaian Pekerjaan Minggu Ini");
  if (sl.butir.length > 0) y = butirList(doc, sl.butir.slice(0, 4), y, { fontSize: 11.5 });
  if (sl.rincian.length > 0) {
    tabel(
      doc,
      [
        { label: "Lokasi", w: 210 },
        { label: "Pekerjaan", w: CW - 210 - 160 },
        { label: "Volume minggu ini", w: 160, align: "right" },
      ],
      sl.rincian.map((c) => [
        c.lokasiNama,
        c.pekerjaan,
        `${String(c.volume).replace(".", ",")}${c.unit ? ` ${c.unit}` : ""}`,
      ]),
      y + 4,
    );
  } else if (sl.butir.length === 0) {
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(C.inkMuted).text(
      "Tidak ada capaian pekerjaan terhitung pada minggu ini.",
      MX,
      y,
      { width: CW },
    );
  }
}

function renderKegiatan(doc: PdfDoc, sl: Extract<Slide, { jenis: "kegiatan" }>): void {
  latarTerang(doc);
  let y = judulTerang(doc, "Kegiatan Lapangan");
  if (sl.butir.length > 0) y = butirList(doc, sl.butir.slice(0, 4), y, { fontSize: 11.5 });
  if (sl.rincian.length > 0) {
    tabel(
      doc,
      [
        { label: "Tanggal", w: 96 },
        { label: "Jenis", w: 140 },
        { label: "Kegiatan", w: CW - 96 - 140 - 190 },
        { label: "Lokasi", w: 190 },
      ],
      sl.rincian.map((g) => [g.tanggalKey, g.jenis, g.judul, g.lokasiNama]),
      y + 4,
    );
  } else if (sl.butir.length === 0) {
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(C.inkMuted).text(
      "Tidak ada kegiatan lapangan final pada minggu ini.",
      MX,
      y,
      { width: CW },
    );
  }
}

function renderKendala(doc: PdfDoc, sl: Extract<Slide, { jenis: "kendala" }>): void {
  latarTerang(doc);
  let y = judulTerang(doc, "Kendala Kontrak");
  if (sl.butir.length > 0) y = butirList(doc, sl.butir.slice(0, 3), y, { fontSize: 11 });
  const blok = (judul: string, rows: typeof sl.baru) => {
    doc.font(PDF_FONT.bold).fontSize(11).fillColor(C.cyanTua).text(s(judul), MX, y, { width: CW });
    y = doc.y + 4;
    if (rows.length === 0) {
      doc.font(PDF_FONT.regular).fontSize(10).fillColor(C.inkMuted).text("Tidak ada.", MX, y, { width: CW });
      y = doc.y + 8;
      return;
    }
    y = tabel(
      doc,
      [
        { label: "Kendala", w: CW - 180 - 100 - 120 },
        { label: "Lokasi", w: 180 },
        { label: "Tingkat", w: 100 },
        { label: "Recovery", w: 120 },
      ],
      rows.map((k) => [k.judul, k.lokasiNama, k.severity, k.punyaRecovery ? "ada" : "belum ada"]),
      y,
    );
  };
  blok("Kendala baru minggu ini", sl.baru);
  blok(sl.statusTerkini ? "Kendala aktif SAAT PAPARAN DIBUAT (status terkini)" : "Kendala aktif", sl.aktif);
}

function renderPemulihan(doc: PdfDoc, sl: Extract<Slide, { jenis: "pemulihan" }>): void {
  latarTerang(doc);
  const y = judulTerang(
    doc,
    sl.totalBagian > 1 ? `Recovery & Tindak Lanjut (${sl.bagian}/${sl.totalBagian})` : "Recovery & Tindak Lanjut",
  );
  tabel(
    doc,
    [
      { label: "Kendala", w: 220 },
      { label: "Tindakan", w: CW - 220 - 130 - 96 - 104 },
      { label: "PIC", w: 130 },
      { label: "Target", w: 96 },
      { label: "Status", w: 104 },
    ],
    sl.baris.map((r) => [
      r.judulKendala,
      r.tindakan,
      r.pic ?? "BELUM ADA PIC",
      r.targetKey ?? "–",
      r.overdue ? `${r.status} (LEWAT)` : r.status,
    ]),
    y,
  );
}

/** Action Plan — kartu bernomor bergaris kiri cyan (pola contoh Mataram). */
function renderActionPlan(doc: PdfDoc, sl: Extract<Slide, { jenis: "action_plan" }>): void {
  latarTerang(doc);
  let y = judulTerang(doc, "Action Plan");
  sl.butir.forEach((b, i) => {
    const teksW = CW - 84;
    doc.font(PDF_FONT.regular).fontSize(12.5);
    const th = doc.heightOfString(s(b), { width: teksW, lineGap: 2 });
    const kh = Math.max(44, th + 22);
    doc.roundedRect(MX + 6, y, CW - 6, kh, 8).fillColor(C.putih).fill();
    doc.roundedRect(MX + 6, y, CW - 6, kh, 8).lineWidth(0.6).strokeColor(C.garis).stroke();
    doc.rect(MX, y + 2, 4, kh - 4).fillColor(C.cyan).fill();
    doc.font(PDF_FONT.bold).fontSize(16).fillColor(C.cyan).text(
      `0${i + 1}`,
      MX + 22,
      y + kh / 2 - 10,
      { lineBreak: false },
    );
    doc.font(PDF_FONT.regular).fontSize(12.5).fillColor(C.ink).text(s(b), MX + 66, y + (kh - th) / 2, {
      width: teksW,
      lineGap: 2,
    });
    y += kh + 12;
  });
  if (sl.dukungan.length > 0) {
    doc.font(PDF_FONT.bold).fontSize(11.5).fillColor(C.cyanTua).text("Dukungan / keputusan yang dibutuhkan dari KKP", MX, y + 4, {
      width: CW,
    });
    butirList(doc, sl.dukungan, doc.y + 6, { fontSize: 11 });
  }
}

function renderLampiran(doc: PdfDoc, sl: Extract<Slide, { jenis: "lampiran" }>): void {
  latarTerang(doc);
  let y = judulTerang(doc, "Lampiran – Kelengkapan Data & Sumber");
  const k = sl.kelengkapan;
  y = tabel(
    doc,
    [
      { label: "Laporan diharapkan", w: CW / 6, align: "right" },
      { label: "Final", w: CW / 6, align: "right" },
      { label: "Diproses", w: CW / 6, align: "right" },
      { label: "Draft", w: CW / 6, align: "right" },
      { label: "Perlu koreksi", w: CW / 6, align: "right" },
      { label: "Hari nihil", w: CW / 6, align: "right" },
    ],
    [[`${k.diharapkan}`, `${k.final}`, `${k.diproses}`, `${k.draft}`, `${k.perluKoreksi}`, `${k.hariNihil}`]],
    y,
  );
  if (k.lokasiTanpaLaporan.length > 0) {
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(C.oranye).text(
      s(`Lokasi tanpa laporan minggu ini: ${k.lokasiTanpaLaporan.join(", ")}`),
      MX,
      y,
      { width: CW },
    );
    y = doc.y + 6;
  }
  if (sl.lokasiTanpaKurva > 0) {
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(C.oranye).text(
      s(`${sl.lokasiTanpaKurva} lokasi belum punya kurva-S.`),
      MX,
      y,
      { width: CW },
    );
    y = doc.y + 6;
  }
  doc.font(PDF_FONT.regular).fontSize(9).fillColor(C.inkMuted).text(
    s(
      `Data per: ${sl.dataAsOf ? sl.dataAsOf.slice(0, 16).replace("T", " ") : "tidak tersedia"} · Seluruh angka dihitung MARLIN dari laporan harian, kurva-S, kegiatan, dan kendala yang tercatat.`,
    ),
    MX,
    y + 4,
    { width: CW },
  );
  y = doc.y + 8;
  if (sl.limitations.length > 0) {
    doc.font(PDF_FONT.bold).fontSize(10).fillColor(C.cyanTua).text("Keterbatasan data", MX, y, { width: CW });
    butirList(doc, sl.limitations, doc.y + 4, { fontSize: 8.5, warna: C.inkMuted });
  }
}

function renderPenutup(doc: PdfDoc, sl: Extract<Slide, { jenis: "penutup" }>): void {
  latarGelap(doc);
  doc.font(PDF_FONT.bold).fontSize(42).fillColor(C.putih).text("Terima Kasih", 0, H / 2 - 66, {
    width: W,
    align: "center",
  });
  doc.font(PDF_FONT.bold).fontSize(20).fillColor(C.cyan).text("Tetap Semangat", 0, doc.y + 10, {
    width: W,
    align: "center",
  });
  doc.font(PDF_FONT.regular).fontSize(10).fillColor("#61708c").text(
    s(`${sl.paket}  ·  Minggu Ke-${sl.mingguKe}  ·  ${sl.periodeLabel}`),
    0,
    doc.y + 26,
    { width: W, align: "center" },
  );
}

/* ── Entry ──────────────────────────────────────────────────────────────── */

const SLIDE_GELAP = new Set<Slide["jenis"]>(["sampul", "durasi", "foto_pekerjaan", "penutup"]);

export async function renderPaparanPdf(content: PaparanContent, opts: { draf: boolean }): Promise<Buffer> {
  const slides = susunSlides(content, { draf: opts.draf });
  const judul = judulPaparan(content);

  const fotoIds = slides.flatMap((sl) => (sl.jenis === "foto_pekerjaan" ? sl.foto : []));
  const gambar = new Map<string, string | null>();
  for (const f of fotoIds) gambar.set(f.id, await ambilFoto(f.r2Key));

  const doc = createDeck169Doc({ title: judul });
  const footKiri = `${content.snapshot.paket.name} · Minggu ke-${content.weekNumber} (${content.snapshot.periode.mulaiKey} s.d. ${content.snapshot.periode.akhirKey}) · ${opts.draf ? "DRAF" : "FINAL"}`;

  for (let i = 0; i < slides.length; i++) {
    if (i > 0) doc.addPage();
    const sl = slides[i];
    switch (sl.jenis) {
      case "sampul":
        renderSampul(doc, sl);
        break;
      case "kurva":
        renderKurva(doc, sl);
        break;
      case "durasi":
        renderDurasi(doc, sl);
        break;
      case "ringkasan":
        renderRingkasan(doc, sl);
        break;
      case "progres_lokasi":
        renderProgresLokasi(doc, sl);
        break;
      case "status_kategori":
        renderStatusKategori(doc, sl);
        break;
      case "capaian":
        renderCapaian(doc, sl);
        break;
      case "kegiatan":
        renderKegiatan(doc, sl);
        break;
      case "foto_pekerjaan":
        await renderFotoPekerjaan(doc, sl, gambar);
        break;
      case "kendala":
        renderKendala(doc, sl);
        break;
      case "pemulihan":
        renderPemulihan(doc, sl);
        break;
      case "action_plan":
        renderActionPlan(doc, sl);
        break;
      case "lampiran":
        renderLampiran(doc, sl);
        break;
      case "penutup":
        renderPenutup(doc, sl);
        break;
    }
    if (opts.draf) watermarkDraf(doc, SLIDE_GELAP.has(sl.jenis));
    footer(doc, footKiri, i + 1, slides.length, SLIDE_GELAP.has(sl.jenis));
  }
  return docToBuffer(doc);
}

export function namaBerkasPaparan(content: PaparanContent, versi: number): string {
  const paket = content.snapshot.paket.name
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `Paparan_KKP_${paket}_Minggu_${content.weekNumber}_v${versi}.pdf`;
}

export function rupiahDariString(v: string): string {
  try {
    return formatRupiah(BigInt(v));
  } catch {
    return v;
  }
}
