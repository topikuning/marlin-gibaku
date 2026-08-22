import "server-only";
import sharp from "sharp";
import { isR2Configured, r2GetBuffer } from "@/lib/r2";
import {
  DECK_169,
  PDF_COLORS,
  PDF_FONT,
  createDeck169Doc,
  docToBuffer,
  sanitizeText,
  type PdfDoc,
} from "@/lib/pdf/document";
import { formatRupiah } from "@/lib/format";
import type { PaparanContent } from "./jenis";
import { judulPaparan, pctID, ppID, susunSlides, type Slide } from "./susun";

/**
 * RENDERER PDF PAPARAN 16:9 (DECISIONS 416) — pdfkit, tanpa Chromium.
 *
 * Membaca structured content kanonik yang SAMA dengan preview web; tidak ada
 * angka dihitung ulang di sini. Draft ber-watermark di SETIAP slide; PDF final
 * (artefak beku) tanpa watermark.
 */

const W = DECK_169.width;
const H = DECK_169.height;
const MX = 48; // margin kiri-kanan slide
const MT = 44; // atas
const MB = 36; // bawah (di atas footer)
const CW = W - MX * 2;

function s(t: string): string {
  return sanitizeText(t);
}

/* ── Kerangka slide ─────────────────────────────────────────────────────── */

function judulSlide(doc: PdfDoc, teks: string): number {
  doc.font(PDF_FONT.bold).fontSize(20).fillColor(PDF_COLORS.primary).text(s(teks), MX, MT, { width: CW });
  const y = doc.y + 6;
  doc.moveTo(MX, y).lineTo(MX + CW, y).lineWidth(2).strokeColor(PDF_COLORS.primary600).stroke();
  return y + 14;
}

function footer(doc: PdfDoc, kiri: string, nomor: number, total: number): void {
  const y = H - 24;
  doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLORS.inkFaint);
  doc.text(s(kiri), MX, y, { width: CW - 80, lineBreak: false });
  doc.text(`Slide ${nomor}/${total}`, MX, y, { width: CW, align: "right", lineBreak: false });
}

function watermarkDraf(doc: PdfDoc): void {
  doc.save();
  doc.font(PDF_FONT.bold).fontSize(46).fillColor("#dc2626").opacity(0.13);
  doc.rotate(-18, { origin: [W / 2, H / 2] });
  doc.text("DRAF – BELUM DISETUJUI", 0, H / 2 - 30, { width: W, align: "center" });
  doc.restore();
  doc.opacity(1);
}

function butirList(doc: PdfDoc, butir: string[], y0: number, opts?: { fontSize?: number; width?: number; x?: number }): number {
  const x = opts?.x ?? MX;
  const w = opts?.width ?? CW;
  const fs = opts?.fontSize ?? 13;
  let y = y0;
  for (const b of butir) {
    doc.circle(x + 4, y + fs / 2, 2.2).fillColor(PDF_COLORS.primary600).fill();
    doc.font(PDF_FONT.regular).fontSize(fs).fillColor(PDF_COLORS.ink);
    doc.text(s(b), x + 16, y, { width: w - 16, lineGap: 2 });
    y = doc.y + 8;
  }
  return y;
}

/** Kartu angka besar (KPI) berjajar. */
function kartuAngka(doc: PdfDoc, items: { label: string; nilai: string; warna?: string }[], y: number): number {
  const gap = 14;
  const cw = (CW - gap * (items.length - 1)) / items.length;
  const ch = 76;
  items.forEach((it, i) => {
    const x = MX + i * (cw + gap);
    doc.roundedRect(x, y, cw, ch, 8).lineWidth(1).strokeColor(PDF_COLORS.border).stroke();
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(PDF_COLORS.inkMuted).text(s(it.label).toUpperCase(), x + 12, y + 12, { width: cw - 24 });
    doc.font(PDF_FONT.bold).fontSize(24).fillColor(it.warna ?? PDF_COLORS.primary).text(s(it.nilai), x + 12, y + 32, { width: cw - 24 });
  });
  return y + ch + 16;
}

type Kolom = { label: string; w: number; align?: "left" | "right" };

/** Tabel sederhana; pemecahan antar-slide dilakukan perakit slide, bukan di sini. */
function tabel(doc: PdfDoc, kolom: Kolom[], baris: string[][], y0: number): number {
  const rowH = 24;
  let y = y0;
  let x = MX;
  doc.rect(MX, y, CW, rowH).fillColor(PDF_COLORS.primary50).fill();
  doc.font(PDF_FONT.bold).fontSize(10).fillColor(PDF_COLORS.primary);
  for (const k of kolom) {
    doc.text(s(k.label), x + 6, y + 7, { width: k.w - 12, align: k.align ?? "left", lineBreak: false });
    x += k.w;
  }
  y += rowH;
  doc.font(PDF_FONT.regular).fontSize(10);
  for (const row of baris) {
    x = MX;
    doc.moveTo(MX, y + rowH).lineTo(MX + CW, y + rowH).lineWidth(0.5).strokeColor(PDF_COLORS.border).stroke();
    row.forEach((sel, i) => {
      const k = kolom[i];
      doc.fillColor(PDF_COLORS.ink).text(s(sel), x + 6, y + 7, {
        width: k.w - 12,
        align: k.align ?? "left",
        lineBreak: false,
        ellipsis: true,
      } as never);
      x += k.w;
    });
    y += rowH;
  }
  return y + 10;
}

/* ── Foto ───────────────────────────────────────────────────────────────── */

async function ambilFoto(r2Key: string): Promise<Buffer | null> {
  if (!isR2Configured()) return null;
  try {
    const raw = await r2GetBuffer(r2Key);
    return await sharp(raw).rotate().resize(640, 360, { fit: "cover" }).jpeg({ quality: 72 }).toBuffer();
  } catch {
    return null;
  }
}

/* ── Render per jenis slide ─────────────────────────────────────────────── */

function renderSampul(doc: PdfDoc, sl: Extract<Slide, { jenis: "sampul" }>): void {
  doc.rect(0, 0, W, 8).fillColor(PDF_COLORS.primary).fill();
  doc.font(PDF_FONT.regular).fontSize(12).fillColor(PDF_COLORS.inkMuted).text(s(sl.instansi.toUpperCase()), MX, 90, {
    width: CW,
    align: "center",
    characterSpacing: 1,
  });
  doc.font(PDF_FONT.bold).fontSize(26).fillColor(PDF_COLORS.primary).text(s(sl.judulKerja), MX, 130, {
    width: CW,
    align: "center",
  });
  doc.font(PDF_FONT.bold).fontSize(16).fillColor(PDF_COLORS.ink).text(
    s(`Paparan Mingguan – Minggu ke-${sl.mingguKe}${sl.berjalan ? " (BELUM GENAP)" : ""}`),
    MX,
    doc.y + 18,
    { width: CW, align: "center" },
  );
  doc.font(PDF_FONT.regular).fontSize(12).fillColor(PDF_COLORS.inkMuted).text(s(`Periode ${sl.periodeLabel}`), MX, doc.y + 6, {
    width: CW,
    align: "center",
  });
  const y = 320;
  doc.font(PDF_FONT.regular).fontSize(11).fillColor(PDF_COLORS.ink);
  doc.text(s(`Nomor Kontrak : ${sl.nomorKontrak}`), MX, y, { width: CW, align: "center" });
  doc.text(s(`Pelaksana : ${sl.pelaksana}`), MX, doc.y + 4, { width: CW, align: "center" });
}

function renderRingkasan(doc: PdfDoc, sl: Extract<Slide, { jenis: "ringkasan" }>): void {
  let y = judulSlide(doc, "Ringkasan Eksekutif");
  y = kartuAngka(
    doc,
    [
      { label: "Rencana", nilai: pctID(sl.angka.rencana) },
      { label: "Realisasi", nilai: pctID(sl.angka.realisasi) },
      {
        label: "Deviasi",
        nilai: ppID(sl.angka.deviasi),
        warna: sl.angka.deviasi != null && sl.angka.deviasi < 0 ? "#dc2626" : PDF_COLORS.success,
      },
      { label: "Laporan final", nilai: `${sl.angka.laporanFinal}/${sl.angka.laporanDiharapkan}` },
    ],
    y,
  );
  butirList(doc, sl.butir, y + 4);
}

function renderProgresPaket(doc: PdfDoc, sl: Extract<Slide, { jenis: "progres_paket" }>): void {
  let y = judulSlide(doc, `Progres Kontrak – Minggu ke-${sl.mingguKe} dari ${sl.totalMinggu}`);
  y = kartuAngka(
    doc,
    [
      { label: "Rencana s.d. minggu ini", nilai: pctID(sl.p.targetPct) },
      { label: "Realisasi s.d. minggu ini", nilai: pctID(sl.p.realisasiPct) },
      {
        label: "Deviasi",
        nilai: ppID(sl.p.deviasiPp),
        warna: sl.p.deviasiPp != null && sl.p.deviasiPp < 0 ? "#dc2626" : PDF_COLORS.success,
      },
      { label: "Kenaikan minggu ini", nilai: ppID(sl.p.kenaikanPp) },
    ],
    y,
  );
  // Visual rencana vs realisasi sederhana (spec §8 slide 3 — kurva-S paket
  // belum punya seri canonical; jangan menulis formula baru di renderer).
  const barY = y + 10;
  const barW = CW - 160;
  const gambarBar = (label: string, v: number | null, warna: string, yy: number) => {
    doc.font(PDF_FONT.regular).fontSize(10).fillColor(PDF_COLORS.inkMuted).text(s(label), MX, yy + 2, { width: 110 });
    doc.roundedRect(MX + 120, yy, barW, 16, 4).fillColor("#f1f5f9").fill();
    if (v != null && v > 0) {
      doc.roundedRect(MX + 120, yy, Math.max(4, (Math.min(v, 100) / 100) * barW), 16, 4).fillColor(warna).fill();
    }
    doc.font(PDF_FONT.bold).fontSize(10).fillColor(PDF_COLORS.ink).text(pctID(v), MX + 120 + barW + 8, yy + 2, {
      lineBreak: false,
    });
  };
  gambarBar("Rencana", sl.p.targetPct, PDF_COLORS.primary600, barY);
  gambarBar("Realisasi", sl.p.realisasiPct, PDF_COLORS.success, barY + 28);
  if (sl.p.lokasiTanpaKurva > 0) {
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(PDF_COLORS.warning).text(
      s(`${sl.p.lokasiTanpaKurva} lokasi belum ada kurva-S – tidak ikut penyebut target paket.`),
      MX,
      barY + 64,
      { width: CW },
    );
  }
  if (sl.berjalan) {
    doc.font(PDF_FONT.bold).fontSize(10).fillColor(PDF_COLORS.warning).text(
      "Minggu berjalan – data belum genap tujuh hari.",
      MX,
      barY + 84,
      { width: CW },
    );
  }
}

function renderProgresLokasi(doc: PdfDoc, sl: Extract<Slide, { jenis: "progres_lokasi" }>): void {
  const y = judulSlide(
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
  let y = judulSlide(doc, "Capaian Pekerjaan Minggu Ini");
  if (sl.butir.length > 0) y = butirList(doc, sl.butir.slice(0, 4), y, { fontSize: 12 });
  if (sl.rincian.length > 0) {
    tabel(
      doc,
      [
        { label: "Lokasi", w: 220 },
        { label: "Pekerjaan", w: CW - 220 - 160 },
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
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(PDF_COLORS.inkMuted).text(
      "Tidak ada capaian pekerjaan terhitung pada minggu ini.",
      MX,
      y,
      { width: CW },
    );
  }
}

function renderKegiatan(doc: PdfDoc, sl: Extract<Slide, { jenis: "kegiatan" }>): void {
  let y = judulSlide(doc, "Kegiatan Lapangan");
  if (sl.butir.length > 0) y = butirList(doc, sl.butir.slice(0, 4), y, { fontSize: 12 });
  if (sl.rincian.length > 0) {
    tabel(
      doc,
      [
        { label: "Tanggal", w: 100 },
        { label: "Jenis", w: 150 },
        { label: "Kegiatan", w: CW - 100 - 150 - 200 },
        { label: "Lokasi", w: 200 },
      ],
      sl.rincian.map((g) => [g.tanggalKey, g.jenis, g.judul, g.lokasiNama]),
      y + 4,
    );
  } else if (sl.butir.length === 0) {
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(PDF_COLORS.inkMuted).text(
      "Tidak ada kegiatan lapangan final pada minggu ini.",
      MX,
      y,
      { width: CW },
    );
  }
}

async function renderDokumentasi(
  doc: PdfDoc,
  sl: Extract<Slide, { jenis: "dokumentasi" }>,
  gambar: Map<string, Buffer | null>,
): Promise<void> {
  const y0 = judulSlide(doc, "Dokumentasi");
  const n = sl.foto.length;
  const kolom = n <= 4 ? Math.min(n, 2) : n <= 6 ? 3 : 4;
  const barisN = Math.ceil(n / kolom);
  const gap = 12;
  const cw = (CW - gap * (kolom - 1)) / kolom;
  const tinggiTotal = H - MB - y0 - 8;
  const ch = (tinggiTotal - gap * (barisN - 1)) / barisN;
  const imgH = ch - 26;
  sl.foto.forEach((f, i) => {
    const x = MX + (i % kolom) * (cw + gap);
    const y = y0 + Math.floor(i / kolom) * (ch + gap);
    const buf = gambar.get(f.id) ?? null;
    if (buf) {
      doc.save();
      doc.roundedRect(x, y, cw, imgH, 6).clip();
      doc.image(buf, x, y, { cover: [cw, imgH], align: "center", valign: "center" } as never);
      doc.restore();
    } else {
      // Placeholder JELAS — foto gagal tidak menggagalkan PDF (spec §8/§13).
      doc.roundedRect(x, y, cw, imgH, 6).fillColor("#f1f5f9").fill();
      doc.font(PDF_FONT.regular).fontSize(9).fillColor(PDF_COLORS.inkMuted).text(
        "Foto tidak dapat dimuat",
        x,
        y + imgH / 2 - 6,
        { width: cw, align: "center" },
      );
    }
    doc.font(PDF_FONT.regular).fontSize(8.5).fillColor(PDF_COLORS.inkMuted).text(s(f.caption), x, y + imgH + 4, {
      width: cw,
      height: 20,
      ellipsis: true,
    } as never);
  });
}

function renderKendala(doc: PdfDoc, sl: Extract<Slide, { jenis: "kendala" }>): void {
  let y = judulSlide(doc, "Kendala Kontrak");
  if (sl.butir.length > 0) y = butirList(doc, sl.butir.slice(0, 3), y, { fontSize: 12 });
  const barisKendala = (judul: string, rows: typeof sl.baru) => {
    doc.font(PDF_FONT.bold).fontSize(11).fillColor(PDF_COLORS.primary).text(s(judul), MX, y, { width: CW });
    y = doc.y + 4;
    if (rows.length === 0) {
      doc.font(PDF_FONT.regular).fontSize(10).fillColor(PDF_COLORS.inkMuted).text("Tidak ada.", MX, y, { width: CW });
      y = doc.y + 8;
      return;
    }
    y = tabel(
      doc,
      [
        { label: "Kendala", w: CW - 190 - 110 - 130 },
        { label: "Lokasi", w: 190 },
        { label: "Tingkat", w: 110 },
        { label: "Recovery", w: 130 },
      ],
      rows.map((k) => [k.judul, k.lokasiNama, k.severity, k.punyaRecovery ? "ada" : "belum ada"]),
      y,
    );
  };
  barisKendala("Kendala baru minggu ini", sl.baru);
  barisKendala(sl.statusTerkini ? "Kendala aktif SAAT PAPARAN DIBUAT (status terkini)" : "Kendala aktif", sl.aktif);
}

function renderPemulihan(doc: PdfDoc, sl: Extract<Slide, { jenis: "pemulihan" }>): void {
  const y = judulSlide(
    doc,
    sl.totalBagian > 1 ? `Recovery & Tindak Lanjut (${sl.bagian}/${sl.totalBagian})` : "Recovery & Tindak Lanjut",
  );
  tabel(
    doc,
    [
      { label: "Kendala", w: 240 },
      { label: "Tindakan", w: CW - 240 - 140 - 100 - 110 },
      { label: "PIC", w: 140 },
      { label: "Target", w: 100 },
      { label: "Status", w: 110 },
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

function renderRencana(doc: PdfDoc, sl: Extract<Slide, { jenis: "rencana" }>): void {
  let y = judulSlide(doc, "Rencana Minggu Berikutnya & Dukungan KKP");
  if (!sl.adaRencana && sl.butir.length === 0) {
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(PDF_COLORS.inkMuted).text(
      "Rencana minggu berikutnya belum tersedia di MARLIN.",
      MX,
      y,
      { width: CW },
    );
    y = doc.y + 14;
  } else {
    y = butirList(doc, sl.butir, y, { fontSize: 12 });
  }
  doc.font(PDF_FONT.bold).fontSize(12).fillColor(PDF_COLORS.primary).text("Dukungan / keputusan yang dibutuhkan", MX, y + 6, {
    width: CW,
  });
  y = doc.y + 6;
  if (sl.dukungan.length === 0) {
    doc.font(PDF_FONT.regular).fontSize(11).fillColor(PDF_COLORS.inkMuted).text(
      "Tidak ada permintaan dukungan khusus minggu ini.",
      MX,
      y,
      { width: CW },
    );
  } else {
    butirList(doc, sl.dukungan, y, { fontSize: 12 });
  }
}

function renderLampiran(doc: PdfDoc, sl: Extract<Slide, { jenis: "lampiran" }>): void {
  let y = judulSlide(doc, "Lampiran – Kelengkapan Data & Sumber");
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
    doc.font(PDF_FONT.regular).fontSize(10).fillColor(PDF_COLORS.warning).text(
      s(`Lokasi tanpa laporan minggu ini: ${k.lokasiTanpaLaporan.join(", ")}`),
      MX,
      y,
      { width: CW },
    );
    y = doc.y + 6;
  }
  if (sl.lokasiTanpaKurva > 0) {
    doc.font(PDF_FONT.regular).fontSize(10).fillColor(PDF_COLORS.warning).text(
      s(`${sl.lokasiTanpaKurva} lokasi belum punya kurva-S.`),
      MX,
      y,
      { width: CW },
    );
    y = doc.y + 6;
  }
  doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(PDF_COLORS.inkMuted).text(
    s(`Data per: ${sl.dataAsOf ? sl.dataAsOf.slice(0, 16).replace("T", " ") : "tidak tersedia"} · Seluruh angka dihitung MARLIN dari laporan harian, kurva-S, kegiatan, dan kendala yang tercatat.`),
    MX,
    y + 4,
    { width: CW },
  );
  y = doc.y + 8;
  if (sl.limitations.length > 0) {
    doc.font(PDF_FONT.bold).fontSize(10).fillColor(PDF_COLORS.primary).text("Keterbatasan data", MX, y, { width: CW });
    butirList(doc, sl.limitations, doc.y + 4, { fontSize: 9 });
  }
}

/* ── Entry ──────────────────────────────────────────────────────────────── */

/**
 * Render deck → Buffer PDF. `draf` menentukan watermark; PDF final HANYA boleh
 * dipanggil route untuk artefak beku/disetujui (dijaga pemanggil).
 */
export async function renderPaparanPdf(content: PaparanContent, opts: { draf: boolean }): Promise<Buffer> {
  const slides = susunSlides(content, { draf: opts.draf });
  const judul = judulPaparan(content);

  // Foto diambil DI MUKA (async) — pdfkit menggambar sinkron per halaman.
  const fotoIds = slides.flatMap((sl) => (sl.jenis === "dokumentasi" ? sl.foto : []));
  const gambar = new Map<string, Buffer | null>();
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
      case "ringkasan":
        renderRingkasan(doc, sl);
        break;
      case "progres_paket":
        renderProgresPaket(doc, sl);
        break;
      case "progres_lokasi":
        renderProgresLokasi(doc, sl);
        break;
      case "capaian":
        renderCapaian(doc, sl);
        break;
      case "kegiatan":
        renderKegiatan(doc, sl);
        break;
      case "dokumentasi":
        await renderDokumentasi(doc, sl, gambar);
        break;
      case "kendala":
        renderKendala(doc, sl);
        break;
      case "pemulihan":
        renderPemulihan(doc, sl);
        break;
      case "rencana":
        renderRencana(doc, sl);
        break;
      case "lampiran":
        renderLampiran(doc, sl);
        break;
    }
    if (opts.draf) watermarkDraf(doc);
    footer(doc, footKiri, i + 1, slides.length);
  }
  return docToBuffer(doc);
}

/** Nama berkas unduhan yang aman. */
export function namaBerkasPaparan(content: PaparanContent, versi: number): string {
  const paket = content.snapshot.paket.name
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `Paparan_KKP_${paket}_Minggu_${content.weekNumber}_v${versi}.pdf`;
}

/** Uang dari string BigInt snapshot — dipakai preview web juga. */
export function rupiahDariString(v: string): string {
  try {
    return formatRupiah(BigInt(v));
  } catch {
    return v;
  }
}
