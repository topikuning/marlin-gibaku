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
import {
  bingkaiGelap,
  butirList,
  chip,
  footerSlide,
  gambarKurva,
  judulSlide,
  kartuAngka,
  latarSlide,
  potongTeks,
  renderPenutupDeck,
  renderSampulDeck,
  tabel,
  warnaGaris,
  warnaRedup,
  warnaSamar,
  warnaSorot,
  warnaTeks,
  warnaTrekBar,
  watermarkDraf,
  buatDeckCtx,
  type DeckCtx,
} from "@/lib/pdf/deck-primitives";
import { formatRupiah } from "@/lib/format";
import { temaDeck } from "./tema";
import type { PaparanContent } from "./jenis";
import {
  bandStatus,
  judulPaparan,
  namaLingkupLokasi,
  pctID,
  ppID,
  susunSlides,
  type Slide,
} from "./susun";

/**
 * RENDERER PDF PAPARAN 16:9 (DECISIONS 416/417) — mengikuti contoh paparan
 * Mataram dari user: slide gelap/terang berselang, aksen cyan, kurva-S,
 * durasi pelaksanaan, bar status per pekerjaan, foto per pekerjaan dengan
 * kepala nama + persen, Action Plan bernomor, penutup "Terima Kasih".
 *
 * RUPA-nya kini bertema (`lib/paparan/tema.ts`, permintaan user 2026-09-19:
 * *"desain layout masih monoton (cuma satu desain) aku butuh beberapa
 * variasi"*): seluruh palet dan bentuk dasar datang dari primitif bertema
 * `lib/pdf/deck-primitives.ts`. Tema "mataram" = desain asli, tanpa perubahan
 * rupa. Yang TIDAK bertema: susunan slide dan setiap angkanya — `susunSlides`
 * tidak pernah melihat tema, dijaga uji.
 *
 * Membaca structured content kanonik yang SAMA dengan preview web; tidak ada
 * angka dihitung ulang. Draft ber-watermark di setiap slide.
 */

const W = DECK_169.width;
const H = DECK_169.height;
const MX = 52;
const CW = W - MX * 2;

function s(t: string): string {
  return sanitizeText(t);
}

/** Warna bar status per band — dari palet tema, bukan hex tetap. */
function warnaBand(ctx: DeckCtx, band: ReturnType<typeof bandStatus>): string {
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

function renderSampul(ctx: DeckCtx, sl: Extract<Slide, { jenis: "sampul" }>, draf: boolean): void {
  const dev = sl.meta.deviasiPp;
  renderSampulDeck(ctx, {
    eyebrow: `PAPARAN MINGGUAN  ·  MINGGU KE-${sl.mingguKe}${sl.berjalan ? "  ·  BELUM GENAP" : ""}`,
    judul: sl.judulKerja,
    subJudul: sl.subJudul,
    meta: [
      { label: "Periode", nilai: sl.periodeLabel },
      { label: "Realisasi", nilai: pctID(sl.meta.realisasiPct) },
      { label: "Rencana", nilai: pctID(sl.meta.rencanaPct) },
      {
        label: "Deviasi",
        nilai: ppID(dev),
        warna: dev != null && dev < 0 ? ctx.tema.palet.merah : ctx.tema.palet.hijau,
      },
    ],
    barisBawah: [sl.instansi, sl.nomorKontrak, sl.pelaksana],
    draf,
  });
}

/* ── Slide: kurva-S ─────────────────────────────────────────────────────── */

function renderKurva(ctx: DeckCtx, sl: Extract<Slide, { jenis: "kurva" }>, gelap: boolean): void {
  const { doc, tema } = ctx;
  latarSlide(ctx, gelap);
  const y0 = judulSlide(ctx, "Diagram Progres S-Curve", gelap);
  const k = sl.kurva;

  // Bidang grafik.
  const gx = MX + 34;
  const gy = y0 + 8;
  const gw = CW - 44;
  const gh = H - gy - 118;

  /*
   * Realisasi dioper sebagai deret sepanjang kontrak dengan null di luar
   * jendela: primitif kurva menggambar hanya yang terisi, jadi rupanya sama
   * dengan garis pendek pada desain asli tanpa cabang khusus.
   */
  const actual: (number | null)[] = Array.from({ length: k.totalMinggu }, () => null);
  for (const t of k.jendela) {
    if (t.minggu >= 1 && t.minggu <= k.totalMinggu) actual[t.minggu - 1] = t.realisasiPct;
  }
  const last = k.jendela[k.jendela.length - 1] ?? null;
  gambarKurva(
    ctx,
    {
      x: gx,
      y: gy,
      w: gw,
      h: gh,
      planPct: k.planPct,
      actualPct: actual,
      mingguSekarang: last ? last.minggu : sl.mingguKe,
    },
    gelap,
  );

  const xDari = (minggu: number) => gx + ((minggu - 1) / Math.max(1, k.totalMinggu - 1)) * gw;
  const yDari = (pct: number) => gy + gh - (Math.min(pct, 100) / 100) * gh;

  // Chip deviasi di samping titik realisasi terakhir.
  if (last && sl.deviasiPp != null) {
    chip(ctx, xDari(last.minggu) + 10, yDari(last.realisasiPct) - 6, s(ppID(sl.deviasiPp).replace(" pp", "%")), {
      warna: sl.deviasiPp < 0 ? tema.palet.merah : tema.palet.hijau,
      gelap,
    });
  }

  // Baris statistik 3 minggu terakhir (pola contoh: nilai + chip kenaikan).
  const ys = gy + gh + 26;
  const selW = CW / Math.max(1, k.jendela.length);
  doc.moveTo(MX, ys - 6).lineTo(MX + CW, ys - 6).lineWidth(0.6).strokeColor(warnaGaris(ctx, gelap)).stroke();
  k.jendela.forEach((t, i) => {
    const x = MX + i * selW + 10;
    const terakhir = i === k.jendela.length - 1;
    if (terakhir) {
      doc.roundedRect(MX + i * selW, ys - 12, selW - 4, 34, Math.min(6, tema.sudutKartu)).fillColor(warnaSorot(ctx, gelap)).fill();
    }
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(warnaRedup(ctx, gelap)).text(`Minggu ${t.minggu}`, x, ys, {
      lineBreak: false,
    });
    let xv = x + doc.widthOfString(`Minggu ${t.minggu}`) + 10;
    doc.font(PDF_FONT.bold).fontSize(12).fillColor(warnaTeks(ctx, gelap)).text(pctID(t.realisasiPct), xv, ys - 2, {
      lineBreak: false,
    });
    xv += doc.widthOfString(pctID(t.realisasiPct)) + 8;
    if (t.kenaikanPp != null) {
      chip(ctx, xv, ys, s(`${t.kenaikanPp >= 0 ? "+" : ""}${t.kenaikanPp.toFixed(2).replace(".", ",")}%`), {
        warna: t.kenaikanPp >= 0 ? tema.palet.hijau : tema.palet.merah,
        gelap,
      });
    }
  });
}

/* ── Slide: durasi (tiga kartu) ─────────────────────────────────────────── */

function renderDurasi(ctx: DeckCtx, sl: Extract<Slide, { jenis: "durasi" }>, gelap: boolean): void {
  const { doc, tema } = ctx;
  const p = tema.palet;
  latarSlide(ctx, gelap);
  const y0 = judulSlide(ctx, "Durasi Pelaksanaan", gelap);
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
  const kartuBiasa = gelap ? p.gelapKartu : p.kartuTerang;
  kartu.forEach((krt, i) => {
    const x = x0 + i * (kw + gap);
    doc.roundedRect(x, yk, kw, kh, Math.min(10, tema.sudutKartu)).fillColor(krt.sorot ? p.aksen : kartuBiasa).fill();
    if (!gelap && !krt.sorot) {
      doc.roundedRect(x, yk, kw, kh, Math.min(10, tema.sudutKartu)).lineWidth(0.8).strokeColor(p.garis).stroke();
    }
    const tintaKartu = krt.sorot ? (gelap ? p.putih : p.putih) : warnaTeks(ctx, gelap);
    doc.font(PDF_FONT.bold).fontSize(44).fillColor(tintaKartu).text(String(krt.nilai), x, yk + 24, {
      width: kw,
      align: "center",
    });
    doc
      .font(PDF_FONT.bold)
      .fontSize(10)
      .fillColor(krt.sorot ? p.putih : warnaRedup(ctx, gelap))
      .text(krt.label, x, yk + 86, { width: kw, align: "center", characterSpacing: 2 });
  });

  // Bar % waktu berjalan.
  const bw = kw * 3 + gap * 2;
  const yb = yk + kh + 36;
  doc.roundedRect(x0, yb, bw, 8, 4).fillColor(warnaTrekBar(ctx, gelap)).fill();
  doc.roundedRect(x0, yb, Math.max(8, (Math.min(d.pctWaktu, 100) / 100) * bw), 8, 4).fillColor(p.aksen).fill();
  doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(warnaRedup(ctx, gelap));
  doc.text("Mulai", x0, yb + 16, { lineBreak: false });
  doc.text("Selesai", x0, yb + 16, { width: bw, align: "right", lineBreak: false });
  doc
    .font(PDF_FONT.bold)
    .fillColor(gelap ? p.aksen : p.aksenTua)
    .text(s(`${d.pctWaktu.toFixed(2).replace(".", ",")}% waktu telah berjalan`), x0, yb + 16, {
      width: bw,
      align: "center",
      lineBreak: false,
    });
}

/* ── Slide: status pekerjaan per kategori (bar dua kolom) ───────────────── */

function renderStatusKategori(
  ctx: DeckCtx,
  sl: Extract<Slide, { jenis: "status_kategori" }>,
  gelap: boolean,
): void {
  const { doc, tema } = ctx;
  latarSlide(ctx, gelap);
  const judul = sl.lokasiNama ? `Status Pekerjaan – ${sl.lokasiNama}` : "Status Pekerjaan";
  const y0 = judulSlide(ctx, sl.totalBagian > 1 ? `${judul} (${sl.bagian}/${sl.totalBagian})` : judul, gelap);
  const kolW = (CW - 48) / 2;
  const tiapKol = Math.ceil(sl.baris.length / 2);
  sl.baris.forEach((b, i) => {
    const kol = Math.floor(i / tiapKol);
    const x = MX + kol * (kolW + 48);
    const y = y0 + (i % tiapKol) * 46;
    const warna = warnaBand(ctx, bandStatus(b.realisasiPct));
    doc.font(PDF_FONT.regular).fontSize(11).fillColor(warnaTeks(ctx, gelap));
    doc.text(potongTeks(ctx, b.nama, kolW - 74), x, y, { width: kolW - 70, lineBreak: false });
    doc.font(PDF_FONT.bold).fontSize(11).fillColor(warna).text(pctID(b.realisasiPct), x, y, {
      width: kolW,
      align: "right",
      lineBreak: false,
    });
    const yb = y + 17;
    doc.roundedRect(x, yb, kolW, 5, 2.5).fillColor(warnaTrekBar(ctx, gelap)).fill();
    if (b.realisasiPct > 0) {
      doc.roundedRect(x, yb, Math.max(4, (Math.min(b.realisasiPct, 100) / 100) * kolW), 5, 2.5).fillColor(warna).fill();
    }
  });
}

/* ── Slide: foto per pekerjaan (kepala + dua foto di pita terang) ───────── */

async function renderFotoPekerjaan(
  ctx: DeckCtx,
  sl: Extract<Slide, { jenis: "foto_pekerjaan" }>,
  gambar: Map<string, string | null>,
  gelap: boolean,
): Promise<void> {
  const { doc, tema } = ctx;
  const p = tema.palet;
  latarSlide(ctx, gelap);
  // Kepala: nama pekerjaan kiri, persen aksen besar kanan (pola contoh).
  doc.font(PDF_FONT.bold).fontSize(18).fillColor(warnaTeks(ctx, gelap));
  doc.text(potongTeks(ctx, sl.judul, CW - 146), MX, 30, { width: CW - 140, lineBreak: false });
  if (sl.pct != null) {
    doc
      .font(PDF_FONT.bold)
      .fontSize(20)
      .fillColor(gelap ? p.aksen : p.aksenTua)
      .text(pctID(sl.pct), MX, 28, { width: CW, align: "right", lineBreak: false });
  }
  doc.moveTo(0, 66).lineTo(W, 66).lineWidth(0.8).strokeColor(warnaGaris(ctx, gelap)).stroke();

  // Pita tengah terang tempat foto duduk (pola contoh: band terang di tengah).
  const py = 96;
  const ph = H - py - 78;
  doc.rect(0, py, W, ph).fillColor(gelap ? p.putih : p.kartuTerang).fill();

  const n = sl.foto.length;
  const gap = 22;
  const fw = n === 1 ? Math.min(CW, 620) : (CW - gap) / 2;
  const fh = ph - 58;
  const x0 = n === 1 ? (W - fw) / 2 : MX;
  const sudutFoto = Math.min(8, tema.sudutKartu);
  sl.foto.forEach((f, i) => {
    const x = x0 + i * (fw + gap);
    const y = py + 18;
    const buf = gambar.get(f.id) ?? null;
    if (buf) {
      doc.save();
      doc.roundedRect(x, y, fw, fh, sudutFoto).clip();
      doc.image(buf, x, y, { cover: [fw, fh], align: "center", valign: "center" } as never);
      doc.restore();
      doc.roundedRect(x, y, fw, fh, sudutFoto).lineWidth(1).strokeColor(p.garis).stroke();
    } else {
      doc.roundedRect(x, y, fw, fh, sudutFoto).fillColor(p.terang).fill();
      doc.font(PDF_FONT.regular).fontSize(10).fillColor(p.inkMuted).text("Foto tidak dapat dimuat", x, y + fh / 2 - 6, {
        width: fw,
        align: "center",
      });
    }
    /*
     * Keterangan foto dibaca dari layar proyektor, bukan dari layar laptop:
     * abu-abu tipis 8.5pt hilang di ruangan terang. Tebal + tinta gelap, plus
     * garis aksen pendek supaya matanya tahu di mana mulai membaca.
     */
    const cy = y + fh + 8;
    doc.rect(x, cy + 2, 3, 11).fillColor(p.aksen).fill();
    doc.font(PDF_FONT.bold).fontSize(9).fillColor(p.ink);
    // DUA baris, bukan satu: keterangan lengkap sering lebih panjang dari
    // separuh slide ("Pekerjaan Sondir termasuk Pelaporan termasuk mobilisasi
    // Alat dan Personil"), dan dipotong satu baris ia kehilangan justru bagian
    // yang membedakan satu foto dari foto sebelahnya.
    doc.text(s(f.caption), x + 8, cy, { width: fw - 8, height: 23, ellipsis: true } as never);
  });
}

/* ── Slide-slide berbasis daftar/tabel ──────────────────────────────────── */

function renderRingkasan(ctx: DeckCtx, sl: Extract<Slide, { jenis: "ringkasan" }>, gelap: boolean): void {
  const p = ctx.tema.palet;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, "Ringkasan Eksekutif", gelap);
  y = kartuAngka(
    ctx,
    [
      { label: "Rencana", nilai: pctID(sl.angka.rencana), warna: warnaTeks(ctx, gelap) },
      { label: "Realisasi", nilai: pctID(sl.angka.realisasi) },
      {
        label: "Deviasi",
        nilai: ppID(sl.angka.deviasi),
        warna: sl.angka.deviasi != null && sl.angka.deviasi < 0 ? p.merah : p.hijau,
      },
      {
        label: "Laporan final",
        nilai: `${sl.angka.laporanFinal}/${sl.angka.laporanDiharapkan}`,
        warna: warnaTeks(ctx, gelap),
      },
    ],
    y,
    gelap,
  );
  butirList(ctx, sl.butir, MX, y + 4, CW, gelap);
}

function renderProgresLokasi(
  ctx: DeckCtx,
  sl: Extract<Slide, { jenis: "progres_lokasi" }>,
  gelap: boolean,
): void {
  latarSlide(ctx, gelap);
  const y = judulSlide(
    ctx,
    sl.totalBagian > 1 ? `Progres per Lokasi (${sl.bagian}/${sl.totalBagian})` : "Progres per Lokasi",
    gelap,
  );
  tabel(
    ctx,
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
    gelap,
  );
}

function renderCapaian(ctx: DeckCtx, sl: Extract<Slide, { jenis: "capaian" }>, gelap: boolean): void {
  const { doc } = ctx;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, "Capaian Pekerjaan Minggu Ini", gelap);
  if (sl.butir.length > 0) y = butirList(ctx, sl.butir.slice(0, 4), MX, y, CW, gelap, { fontSize: 11.5 });
  if (sl.rincian.length > 0) {
    tabel(
      ctx,
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
      gelap,
    );
  } else if (sl.butir.length === 0) {
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(warnaRedup(ctx, gelap)).text(
      "Tidak ada capaian pekerjaan terhitung pada minggu ini.",
      MX,
      y,
      { width: CW },
    );
  }
}

function renderKegiatan(ctx: DeckCtx, sl: Extract<Slide, { jenis: "kegiatan" }>, gelap: boolean): void {
  const { doc } = ctx;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, "Kegiatan Lapangan", gelap);
  if (sl.butir.length > 0) y = butirList(ctx, sl.butir.slice(0, 4), MX, y, CW, gelap, { fontSize: 11.5 });
  if (sl.rincian.length > 0) {
    tabel(
      ctx,
      [
        { label: "Tanggal", w: 96 },
        { label: "Jenis", w: 140 },
        { label: "Kegiatan", w: CW - 96 - 140 - 190 },
        { label: "Lokasi", w: 190 },
      ],
      sl.rincian.map((g) => [g.tanggalKey, g.jenis, g.judul, g.lokasiNama]),
      y + 4,
      gelap,
    );
  } else if (sl.butir.length === 0) {
    doc.font(PDF_FONT.regular).fontSize(12).fillColor(warnaRedup(ctx, gelap)).text(
      "Tidak ada kegiatan lapangan final pada minggu ini.",
      MX,
      y,
      { width: CW },
    );
  }
}

function renderKendala(ctx: DeckCtx, sl: Extract<Slide, { jenis: "kendala" }>, gelap: boolean): void {
  const { doc, tema } = ctx;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, "Kendala Kontrak", gelap);
  if (sl.butir.length > 0) y = butirList(ctx, sl.butir.slice(0, 3), MX, y, CW, gelap, { fontSize: 11 });
  const blok = (judul: string, rows: typeof sl.baru) => {
    doc
      .font(PDF_FONT.bold)
      .fontSize(11)
      .fillColor(gelap ? tema.palet.aksen : tema.palet.aksenTua)
      .text(s(judul), MX, y, { width: CW });
    y = doc.y + 4;
    if (rows.length === 0) {
      doc.font(PDF_FONT.regular).fontSize(10).fillColor(warnaRedup(ctx, gelap)).text("Tidak ada.", MX, y, { width: CW });
      y = doc.y + 8;
      return;
    }
    y = tabel(
      ctx,
      [
        { label: "Kendala", w: CW - 180 - 100 - 120 },
        { label: "Lokasi", w: 180 },
        { label: "Tingkat", w: 100 },
        { label: "Recovery", w: 120 },
      ],
      rows.map((k) => [k.judul, k.lokasiNama, k.severity, k.punyaRecovery ? "ada" : "belum ada"]),
      y,
      gelap,
    );
  };
  blok("Kendala baru minggu ini", sl.baru);
  blok(sl.statusTerkini ? "Kendala aktif SAAT PAPARAN DIBUAT (status terkini)" : "Kendala aktif", sl.aktif);
}

function renderPemulihan(ctx: DeckCtx, sl: Extract<Slide, { jenis: "pemulihan" }>, gelap: boolean): void {
  latarSlide(ctx, gelap);
  const y = judulSlide(
    ctx,
    sl.totalBagian > 1 ? `Recovery & Tindak Lanjut (${sl.bagian}/${sl.totalBagian})` : "Recovery & Tindak Lanjut",
    gelap,
  );
  tabel(
    ctx,
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
    gelap,
  );
}

/** Action Plan — kartu bernomor bergaris kiri aksen (pola contoh Mataram). */
function renderActionPlan(ctx: DeckCtx, sl: Extract<Slide, { jenis: "action_plan" }>, gelap: boolean): void {
  const { doc, tema } = ctx;
  const p = tema.palet;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, "Action Plan", gelap);
  const sudut = Math.min(8, tema.sudutKartu);
  sl.butir.forEach((b, i) => {
    const teksW = CW - 84;
    doc.font(PDF_FONT.regular).fontSize(12.5);
    const th = doc.heightOfString(s(b), { width: teksW, lineGap: 2 });
    const kh = Math.max(44, th + 22);
    doc.roundedRect(MX + 6, y, CW - 6, kh, sudut).fillColor(gelap ? p.gelapKartu : p.putih).fill();
    if (!gelap) {
      doc.roundedRect(MX + 6, y, CW - 6, kh, sudut).lineWidth(0.6).strokeColor(p.garis).stroke();
    }
    doc.rect(MX, y + 2, 4, kh - 4).fillColor(p.aksen).fill();
    // Nomor memakai aksen PENUH (bukan aksen tua) di kedua latar: pada desain
    // asli Mataram angka "01" cyan terang inilah penanda kartunya.
    doc.font(PDF_FONT.bold).fontSize(16).fillColor(p.aksen).text(`0${i + 1}`, MX + 22, y + kh / 2 - 10, {
      lineBreak: false,
    });
    doc.font(PDF_FONT.regular).fontSize(12.5).fillColor(warnaTeks(ctx, gelap)).text(s(b), MX + 66, y + (kh - th) / 2, {
      width: teksW,
      lineGap: 2,
    });
    y += kh + 12;
  });
  if (sl.dukungan.length > 0) {
    doc
      .font(PDF_FONT.bold)
      .fontSize(11.5)
      .fillColor(gelap ? p.aksen : p.aksenTua)
      .text("Dukungan / keputusan yang dibutuhkan dari KKP", MX, y + 4, { width: CW });
    butirList(ctx, sl.dukungan, MX, doc.y + 6, CW, gelap, { fontSize: 11 });
  }
}

function renderLampiran(ctx: DeckCtx, sl: Extract<Slide, { jenis: "lampiran" }>, gelap: boolean): void {
  const { doc, tema } = ctx;
  const p = tema.palet;
  latarSlide(ctx, gelap);
  let y = judulSlide(ctx, "Lampiran – Kelengkapan Data & Sumber", gelap);
  const k = sl.kelengkapan;
  y = tabel(
    ctx,
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
    gelap,
  );
  if (k.lokasiTanpaLaporan.length > 0) {
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(p.oranye).text(
      s(`Lokasi tanpa laporan minggu ini: ${k.lokasiTanpaLaporan.join(", ")}`),
      MX,
      y,
      { width: CW },
    );
    y = doc.y + 6;
  }
  if (sl.lokasiTanpaKurva > 0) {
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(p.oranye).text(
      s(`${sl.lokasiTanpaKurva} lokasi belum punya kurva-S.`),
      MX,
      y,
      { width: CW },
    );
    y = doc.y + 6;
  }
  doc.font(PDF_FONT.regular).fontSize(9).fillColor(warnaRedup(ctx, gelap)).text(
    s(
      `Data per: ${sl.dataAsOf ? sl.dataAsOf.slice(0, 16).replace("T", " ") : "tidak tersedia"} · Seluruh angka dihitung MARLIN dari laporan harian, kurva-S, kegiatan, dan kendala yang tercatat.`,
    ),
    MX,
    y + 4,
    { width: CW },
  );
  y = doc.y + 8;
  if (sl.limitations.length > 0) {
    doc
      .font(PDF_FONT.bold)
      .fontSize(10)
      .fillColor(gelap ? p.aksen : p.aksenTua)
      .text("Keterbatasan data", MX, y, { width: CW });
    butirList(ctx, sl.limitations, MX, doc.y + 4, CW, gelap, {
      fontSize: 8.5,
      warna: warnaRedup(ctx, gelap),
    });
  }
}

function renderPenutup(ctx: DeckCtx, sl: Extract<Slide, { jenis: "penutup" }>): void {
  const { doc, tema } = ctx;
  const gelap = bingkaiGelap(tema);
  renderPenutupDeck(ctx, { judul: "Terima Kasih", sub: "Tetap Semangat" });
  doc.font(PDF_FONT.regular).fontSize(10).fillColor(warnaSamar(ctx, gelap)).text(
    s(`${sl.paket}  ·  Minggu Ke-${sl.mingguKe}  ·  ${sl.periodeLabel}`),
    0,
    doc.y + 26,
    { width: W, align: "center" },
  );
}

/* ── Entry ──────────────────────────────────────────────────────────────── */

/**
 * Jenis slide yang GELAP pada tema berselang — pemetaan per JENIS, bukan
 * posisi. Sengaja: pada desain asli Mataram, sampul/durasi/foto/penutup yang
 * gelap, dan posisinya bergeser begitu jumlah slide tabel berubah. Tema tanpa
 * `berselang` membuat seluruh slide terang.
 */
const SLIDE_GELAP = new Set<Slide["jenis"]>(["sampul", "durasi", "foto_pekerjaan", "penutup"]);

export async function renderPaparanPdf(content: PaparanContent, opts: { draf: boolean }): Promise<Buffer> {
  const slides = susunSlides(content, { draf: opts.draf });
  const judul = judulPaparan(content);
  const tema = temaDeck(content.tema);

  const fotoIds = slides.flatMap((sl) => (sl.jenis === "foto_pekerjaan" ? sl.foto : []));
  const gambar = new Map<string, string | null>();
  for (const f of fotoIds) gambar.set(f.id, await ambilFoto(f.r2Key));

  const doc = createDeck169Doc({ title: judul });
  const ctx = buatDeckCtx(doc, tema);
  const footKiri = `${content.snapshot.paket.name} · Minggu ke-${content.weekNumber} (${content.snapshot.periode.mulaiKey} s.d. ${content.snapshot.periode.akhirKey}) · ${opts.draf ? "DRAF" : "FINAL"}`;

  for (let i = 0; i < slides.length; i++) {
    if (i > 0) doc.addPage();
    const sl = slides[i];
    const gelap = tema.berselang && SLIDE_GELAP.has(sl.jenis);
    switch (sl.jenis) {
      case "sampul":
        renderSampul(ctx, sl, opts.draf);
        break;
      case "kurva":
        renderKurva(ctx, sl, gelap);
        break;
      case "durasi":
        renderDurasi(ctx, sl, gelap);
        break;
      case "ringkasan":
        renderRingkasan(ctx, sl, gelap);
        break;
      case "progres_lokasi":
        renderProgresLokasi(ctx, sl, gelap);
        break;
      case "status_kategori":
        renderStatusKategori(ctx, sl, gelap);
        break;
      case "capaian":
        renderCapaian(ctx, sl, gelap);
        break;
      case "kegiatan":
        renderKegiatan(ctx, sl, gelap);
        break;
      case "foto_pekerjaan":
        await renderFotoPekerjaan(ctx, sl, gambar, gelap);
        break;
      case "kendala":
        renderKendala(ctx, sl, gelap);
        break;
      case "pemulihan":
        renderPemulihan(ctx, sl, gelap);
        break;
      case "action_plan":
        renderActionPlan(ctx, sl, gelap);
        break;
      case "lampiran":
        renderLampiran(ctx, sl, gelap);
        break;
      case "penutup":
        renderPenutup(ctx, sl);
        break;
    }
    /*
     * Sampul membubuhkan watermarknya sendiri di `renderSampulDeck` (bentuk
     * sampulnya yang tahu latarnya gelap atau terang) — menumpuknya lagi di
     * sini akan mencetak dua watermark di slide yang sama.
     */
    if (opts.draf && sl.jenis !== "sampul") watermarkDraf(ctx, gelap);
    footerSlide(ctx, footKiri, i + 1, slides.length, sl.jenis === "penutup" ? bingkaiGelap(tema) : gelap);
  }
  return docToBuffer(doc);
}

export function namaBerkasPaparan(content: PaparanContent, versi: number): string {
  const bersih = (v: string) =>
    v.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  const paket = bersih(content.snapshot.paket.name);
  // Deck lokasi memakai nama lokasi: berkas yang seluruhnya bernama paket akan
  // saling tertimpa di folder unduhan orang yang membuat sebelas deck lokasi.
  const lok = namaLingkupLokasi(content.snapshot);
  const inti = lok ? `${paket}_${bersih(lok)}` : paket;
  return `Paparan_KKP_${inti}_Minggu_${content.weekNumber}_v${versi}.pdf`;
}

export function rupiahDariString(v: string): string {
  try {
    return formatRupiah(BigInt(v));
  } catch {
    return v;
  }
}
