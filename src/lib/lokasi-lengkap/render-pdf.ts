import "server-only";
import sharp from "sharp";
import { isR2Configured, r2GetBuffer } from "@/lib/r2";
import {
  CONTENT_BOTTOM,
  CONTENT_WIDTH,
  PAGE_MARGIN,
  PDF_COLORS,
  PDF_FONT,
  createA4Doc,
  detailBox,
  docToBuffer,
  ensureSpace,
  paragraph,
  reportHeader,
  sanitizeText,
  sectionHeading,
  stampFooters,
  type PdfDoc,
} from "@/lib/pdf/document";
import { colWidths, gridRow, gridRowHeight, type GridCell } from "@/lib/pdf/grid";
import { titikKurvaGaris } from "@/lib/pdf/kurva-garis";
import { formatPct, formatRupiah, formatTanggal, parseDateKey } from "@/lib/format";
import { EWS_KATEGORI_LABEL, EWS_SEVERITY_LABEL, type EwsSeverity } from "@/lib/ews/rules";
import { ISSUE_SEVERITY_LABEL } from "@/lib/lifecycle";
import type { LaporanLokasiLengkap } from "./jenis";

/**
 * LAPORAN LENGKAP LOKASI → PDF A4 POTRET multi-halaman.
 *
 * Menuangkan `LaporanLokasiLengkap` APA ADANYA: setiap angka datang dari
 * snapshot (calculation layer), berkas ini hanya memformat dan menata. Tidak
 * ada penjumlahan, rata-rata, atau selisih yang dihitung di sini — kalau sebuah
 * angka belum ada di snapshot, ia tidak boleh muncul di PDF.
 *
 * Kesimpulan ditaruh di atas, di kotak yang menonjol: pembaca WhatsApp sudah
 * membaca kalimat yang sama, dan orang yang membuka PDF-nya harus menemukan
 * kalimat itu lagi sebelum tabel apa pun.
 */

const s = sanitizeText;

const WARNA_SEVERITY: Record<EwsSeverity, string> = {
  kritis: PDF_COLORS.danger,
  tinggi: PDF_COLORS.warningStrong,
  sedang: PDF_COLORS.info,
};

const WARNA_TINGKAT: Record<string, string> = {
  kritis: PDF_COLORS.danger,
  tinggi: PDF_COLORS.warningStrong,
  sedang: PDF_COLORS.info,
  rendah: PDF_COLORS.inkMuted,
};

/* ── Pemformat kecil (format Indonesia) ────────────────────────────────── */

function tgl(key: string | null | undefined): string {
  if (!key) return "–";
  const d = parseDateKey(key);
  return d ? formatTanggal(d) : key;
}

function pctAtau(v: number | null | undefined, kosong = "–"): string {
  return v == null ? kosong : formatPct(v);
}

function pp(v: number | null | undefined): string {
  if (v == null) return "–";
  const teks = v.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${v > 0 ? "+" : ""}${teks} pp`;
}

function rupiah(v: string): string {
  try {
    return formatRupiah(BigInt(v));
  } catch {
    return v;
  }
}

/* ── Primitif tata letak lokal ─────────────────────────────────────────── */

/** Kartu angka sejajar (label kecil + nilai besar + sub), N kolom. */
function barisKartu(
  doc: PdfDoc,
  kartu: { label: string; nilai: string; sub?: string | null; warna?: string }[],
): void {
  const n = kartu.length;
  if (n === 0) return;
  const gap = 6;
  const w = (CONTENT_WIDTH - gap * (n - 1)) / n;
  const h = 44;
  ensureSpace(doc, h + 10);
  const y = doc.y;
  kartu.forEach((k, i) => {
    const x = PAGE_MARGIN + i * (w + gap);
    doc.roundedRect(x, y, w, h, 5).lineWidth(0.6).strokeColor(PDF_COLORS.border).stroke();
    doc
      .font(PDF_FONT.bold)
      .fontSize(6.5)
      .fillColor(PDF_COLORS.inkMuted)
      .text(s(k.label).toUpperCase(), x + 6, y + 5, { width: w - 12, characterSpacing: 0.3, lineBreak: false });
    /*
     * Nilai ditulis TANPA wrap (satu baris, tinggi kartu tetap), jadi ukuran
     * hurufnya yang mengalah sampai muat. Tanpa ini nilai panjang – rupiah
     * penuh, "belum ada kurva-S" – meluber ke kartu sebelahnya dan dua angka
     * terbaca menempel jadi satu.
     */
    const nilai = s(k.nilai);
    const maksW = w - 12;
    doc.font(PDF_FONT.bold);
    let ukuran = 12;
    while (ukuran > 6.5 && doc.fontSize(ukuran).widthOfString(nilai) > maksW) ukuran -= 0.5;
    doc
      .fontSize(ukuran)
      .fillColor(k.warna ?? PDF_COLORS.ink)
      .text(nilai, x + 6, y + 15 + (12 - ukuran) / 2, { width: maksW, lineBreak: false });
    if (k.sub) {
      doc
        .font(PDF_FONT.regular)
        .fontSize(6.5)
        .fillColor(PDF_COLORS.inkMuted)
        .text(s(k.sub), x + 6, y + 31, { width: w - 12, lineBreak: false });
    }
  });
  doc.y = y + h + 10;
  doc.x = PAGE_MARGIN;
}

/** Tabel grid dengan kepala yang diulang di halaman baru. */
function tabel(
  doc: PdfDoc,
  kepala: string[],
  baris: GridCell[][],
  bobot: number[],
  opts: { fontSize?: number; kosong?: string } = {},
): void {
  const cols = colWidths(CONTENT_WIDTH, bobot);
  const o = { x: PAGE_MARGIN, width: CONTENT_WIDTH, cols, fontSize: opts.fontSize ?? 7.5 };
  const head: GridCell[] = kepala.map((t) => ({ text: t, head: true }));
  if (baris.length === 0) {
    paragraph(doc, opts.kosong ?? "Tidak ada.");
    doc.moveDown(0.4);
    return;
  }
  const gambarKepala = () => {
    doc.y = gridRow(doc, doc.y, head, o);
  };
  ensureSpace(doc, gridRowHeight(doc, head, o) + 24);
  gambarKepala();
  for (const b of baris) {
    const h = gridRowHeight(doc, b, o);
    if (doc.y + h > CONTENT_BOTTOM) {
      doc.addPage();
      gambarKepala();
    }
    doc.y = gridRow(doc, doc.y, b, o);
  }
  doc.y += 8;
  doc.x = PAGE_MARGIN;
}

function catatanKecil(doc: PdfDoc, teks: string): void {
  ensureSpace(doc, 14);
  doc
    .font(PDF_FONT.regular)
    .fontSize(7.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(s(teks), PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 1 });
  doc.moveDown(0.4);
  doc.x = PAGE_MARGIN;
}

/* ── Foto ───────────────────────────────────────────────────────────────── */

/**
 * Foto sebagai DATA URI base64 — bukan Buffer — karena bundle pdfkit yang
 * di-vendor menstub `fs` (jebakan DECISIONS 129; pola sama dengan
 * `paparan/render-pdf.ts`). null = gagal/R2 mati → placeholder.
 */
async function ambilFoto(r2Key: string): Promise<string | null> {
  if (!isR2Configured()) return null;
  try {
    const raw = await r2GetBuffer(r2Key);
    const jpeg = await sharp(raw)
      .rotate()
      .resize(900, 650, { fit: "cover", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

/* ── Renderer ───────────────────────────────────────────────────────────── */

export async function renderLaporanLokasiPdf(
  l: LaporanLokasiLengkap,
  opts: { appName?: string } = {},
): Promise<Buffer> {
  const appName = opts.appName ?? "MARLIN";
  const id = l.identitas;
  const p = l.progres;
  const doc = createA4Doc({ title: `Laporan Lengkap ${id.nama}`, author: appName });

  // Foto diambil lebih dulu (paralel) supaya alir teks tidak menunggu jaringan.
  const fotoTerpilih = l.foto.kandidat.slice(0, 4);
  const gambar = await Promise.all(fotoTerpilih.map((f) => ambilFoto(f.thumbnailKey ?? f.r2Key)));

  /* ── Kop + identitas ─────────────────────────────────────────────────── */

  reportHeader(
    doc,
    appName,
    `${id.paket.nama}${id.paket.nomor ? ` · ${id.paket.nomor}` : ""} · s.d. ${tgl(l.asOfKey)}`,
    "Laporan Lengkap Lokasi",
  );
  doc
    .font(PDF_FONT.bold)
    .fontSize(16)
    .fillColor(PDF_COLORS.ink)
    .text(s(id.nama), PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc
    .font(PDF_FONT.regular)
    .fontSize(9)
    .fillColor(PDF_COLORS.inkMuted)
    .text(
      s(
        [id.desa, id.kecamatan ? `Kec. ${id.kecamatan}` : null, id.kabupaten, id.provinsi]
          .filter(Boolean)
          .join(", "),
      ),
      PAGE_MARGIN,
      doc.y + 1,
      { width: CONTENT_WIDTH },
    );
  doc.moveDown(0.6);

  const rincian: [string, string][] = [
    ["Status lokasi", id.statusLabel],
    ["Paket", `${id.paket.nama} (${id.paket.instansi})`],
  ];
  if (id.kontrak) {
    rincian.push(
      ["Kontrak", `${id.kontrak.nomor}${id.kontrak.judulKerja ? ` – ${id.kontrak.judulKerja}` : ""}`],
      ["Penyedia", id.kontrak.vendor],
      ["Nilai kontrak", `${rupiah(id.kontrak.nilai)} (inkl. PPN)`],
      [
        "Masa kontrak",
        `${tgl(id.kontrak.mulaiKey)} – ${id.kontrak.akhirKey ? tgl(id.kontrak.akhirKey) : "?"} (${id.kontrak.durasiHari} hari)`,
      ],
    );
    if (id.kontrak.ppk) rincian.push(["PPK", id.kontrak.ppk]);
    if (id.kontrak.pengawas) {
      rincian.push(["Pengawas", `${id.kontrak.pengawas}${id.kontrak.pengawasFirma ? ` – ${id.kontrak.pengawasFirma}` : ""}`]);
    }
  } else {
    rincian.push(["Kontrak", "Belum berkontrak / SPMK belum ada"]);
  }
  if (id.pelaksana) rincian.push(["Pelaksana", `${id.pelaksana.nama}${id.pelaksana.jabatan ? ` (${id.pelaksana.jabatan})` : ""}`]);
  if (id.gps) rincian.push(["Koordinat", `${id.gps.lat}, ${id.gps.lng}`]);
  rincian.push(["Posisi data", `s.d. ${tgl(l.asOfKey)} · dibuat ${formatTanggal(new Date(l.dibuatPada), "d MMM yyyy HH.mm")} WIB`]);
  detailBox(doc, rincian);

  /* ── Kesimpulan (kotak menonjol) ─────────────────────────────────────── */

  {
    const teks = l.kesimpulan.length > 0 ? l.kesimpulan.join(" ") : "Kesimpulan belum tersusun.";
    doc.font(PDF_FONT.regular).fontSize(10.5);
    const tinggi = doc.heightOfString(s(teks), { width: CONTENT_WIDTH - 28, lineGap: 2 }) + 34;
    ensureSpace(doc, tinggi + 8);
    const y = doc.y;
    doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, tinggi, 6).fill(PDF_COLORS.primary50);
    doc.rect(PAGE_MARGIN, y, 4, tinggi).fill(PDF_COLORS.primary);
    doc
      .font(PDF_FONT.bold)
      .fontSize(8.5)
      .fillColor(PDF_COLORS.primary)
      .text("KESIMPULAN", PAGE_MARGIN + 14, y + 9, { characterSpacing: 0.8 });
    doc
      .font(PDF_FONT.regular)
      .fontSize(10.5)
      .fillColor(PDF_COLORS.ink)
      .text(s(teks), PAGE_MARGIN + 14, y + 22, { width: CONTENT_WIDTH - 28, lineGap: 2 });
    doc.y = y + tinggi + 12;
    doc.x = PAGE_MARGIN;
  }

  /* ── Ringkasan angka ─────────────────────────────────────────────────── */

  sectionHeading(doc, "Ringkasan progres");
  const warnaDeviasi =
    p.deviasiPp == null ? PDF_COLORS.inkMuted : p.deviasiPp < 0 ? PDF_COLORS.danger : PDF_COLORS.success;
  barisKartu(doc, [
    { label: "Rencana", nilai: p.punyaKurva ? pctAtau(p.rencanaPct) : "belum ada kurva-S" },
    { label: "Realisasi", nilai: p.punyaRab ? formatPct(p.realisasiPct) : "belum ada RAB" },
    { label: "Deviasi", nilai: p.punyaKurva ? pp(p.deviasiPp) : "–", warna: warnaDeviasi },
    { label: "Terverifikasi", nilai: p.punyaRab ? formatPct(p.terverifikasiPct) : "–", sub: "disetujui + final" },
  ]);
  barisKartu(doc, [
    {
      label: "Minggu kontrak",
      nilai: id.kontrak ? `ke-${p.mingguKe}${p.totalMinggu > 0 ? ` / ${p.totalMinggu}` : ""}` : "–",
      sub: id.kontrak ? (p.totalMinggu > 0 ? "dari panjang kurva-S" : "kurva-S belum ada") : "belum berkontrak",
    },
    {
      label: "Durasi",
      nilai: l.durasi ? `${l.durasi.hariBerjalan}/${l.durasi.totalHari} hr` : "–",
      sub: l.durasi ? `sisa ${l.durasi.sisaHari} hari · ${formatPct(l.durasi.pctWaktu, 0)} waktu` : null,
    },
    { label: "Nilai RAB", nilai: p.punyaRab ? rupiah(p.nilaiRab) : "–" },
    { label: "Nilai terpasang", nilai: p.punyaRab ? rupiah(p.nilaiTerpasang) : "–" },
  ]);

  /* ── Kurva-S ─────────────────────────────────────────────────────────── */

  sectionHeading(doc, "Kurva-S rencana vs realisasi");
  if (l.kurva && l.kurva.totalMinggu > 0) {
    const tinggi = 190;
    ensureSpace(doc, tinggi + 30);
    const kotak = { x: PAGE_MARGIN + 30, y: doc.y + 8, w: CONTENT_WIDTH - 40, h: tinggi - 40 };
    const g = titikKurvaGaris(l.kurva, kotak);
    // Grid horizontal + label %
    for (const gy of g.gridY) {
      doc.moveTo(kotak.x, gy.y).lineTo(kotak.x + kotak.w, gy.y).lineWidth(0.4).strokeColor(PDF_COLORS.border).stroke();
      doc
        .font(PDF_FONT.regular)
        .fontSize(6.5)
        .fillColor(PDF_COLORS.inkFaint)
        .text(gy.label, PAGE_MARGIN, gy.y - 3, { width: 26, align: "right", lineBreak: false });
    }
    for (const lx of g.labelX) {
      doc
        .font(PDF_FONT.regular)
        .fontSize(6.5)
        .fillColor(PDF_COLORS.inkFaint)
        .text(lx.label, lx.x - 8, kotak.y + kotak.h + 3, { width: 16, align: "center", lineBreak: false });
    }
    // Penanda minggu berjalan
    const xb = g.xMinggu(l.kurva.mingguBerjalan);
    doc.moveTo(xb, kotak.y).lineTo(xb, kotak.y + kotak.h).lineWidth(0.6).dash(2, { space: 2 }).strokeColor(PDF_COLORS.inkFaint).stroke().undash();
    // Rencana (putus-putus navy)
    if (g.rencana.length > 1) {
      doc.moveTo(g.rencana[0].x, g.rencana[0].y);
      for (const t of g.rencana.slice(1)) doc.lineTo(t.x, t.y);
      doc.lineWidth(1.2).dash(4, { space: 2 }).strokeColor(PDF_COLORS.primary600).stroke().undash();
    }
    // Realisasi (garis tebal)
    if (g.realisasi.length > 1) {
      doc.moveTo(g.realisasi[0].x, g.realisasi[0].y);
      for (const t of g.realisasi.slice(1)) doc.lineTo(t.x, t.y);
      doc.lineWidth(1.8).strokeColor(PDF_COLORS.successStrong).stroke();
      const akhir = g.realisasi[g.realisasi.length - 1];
      doc.circle(akhir.x, akhir.y, 2.2).fill(PDF_COLORS.successStrong);
    }
    doc.y = kotak.y + kotak.h + 14;
    doc.x = PAGE_MARGIN;
    catatanKecil(
      doc,
      `Garis putus-putus = rencana kumulatif; garis tebal = realisasi kumulatif; garis tegak = minggu berjalan ke-${l.kurva.mingguBerjalan} dari ${l.kurva.totalMinggu}. Sumbu X = minggu kontrak, sumbu Y = %.`,
    );
  } else {
    paragraph(doc, "Lokasi ini belum punya kurva-S (baseline) aktif, jadi rencana dan deviasi tidak bisa digambar.");
    doc.moveDown(0.5);
  }

  /* ── Perkembangan mingguan ───────────────────────────────────────────── */

  sectionHeading(doc, "Perkembangan mingguan");
  tabel(
    doc,
    ["Minggu", "Periode", "Rencana", "Realisasi", "Kenaikan", "Deviasi", "Laporan terhitung"],
    l.mingguan.map((m) => [
      { text: `ke-${m.minggu}`, align: "center" },
      { text: `${tgl(m.mulaiKey)} – ${tgl(m.akhirKey)}` },
      { text: pctAtau(m.rencanaPct), align: "right" },
      { text: pctAtau(m.realisasiPct), align: "right" },
      { text: pp(m.kenaikanPp), align: "right" },
      {
        text: pp(m.deviasiPp),
        align: "right",
        color: m.deviasiPp == null ? undefined : m.deviasiPp < 0 ? PDF_COLORS.danger : PDF_COLORS.success,
      },
      { text: String(m.laporanTerhitung), align: "center" },
    ]),
    [1, 2.6, 1.1, 1.1, 1.1, 1.1, 1.3],
    { kosong: "Belum ada minggu kontrak yang bisa dirinci (kontrak belum berjalan)." },
  );

  /* ── Status per kategori RAB ─────────────────────────────────────────── */

  sectionHeading(doc, "Status pekerjaan per kategori RAB");
  if (l.kategori.length === 0) {
    paragraph(doc, "Belum ada RAB aktif untuk lokasi ini.");
    doc.moveDown(0.5);
  } else {
    const labelW = 170;
    const barX = PAGE_MARGIN + labelW + 6;
    const barW = CONTENT_WIDTH - labelW - 6 - 110;
    for (const k of l.kategori) {
      ensureSpace(doc, 16);
      const y = doc.y;
      doc
        .font(PDF_FONT.regular)
        .fontSize(7.5)
        .fillColor(PDF_COLORS.ink)
        .text(s(`${k.lineageKey} ${k.nama}`), PAGE_MARGIN, y + 2, { width: labelW, lineBreak: false, ellipsis: true });
      doc.rect(barX, y + 2, barW, 8).fill(PDF_COLORS.border);
      const isi = Math.max(0, Math.min(100, k.realisasiPct)) / 100;
      if (isi > 0) doc.rect(barX, y + 2, barW * isi, 8).fill(PDF_COLORS.primary600);
      doc
        .font(PDF_FONT.bold)
        .fontSize(7.5)
        .fillColor(PDF_COLORS.ink)
        .text(formatPct(k.realisasiPct), barX + barW + 4, y + 2, { width: 40, align: "right", lineBreak: false });
      doc
        .font(PDF_FONT.regular)
        .fontSize(6.5)
        .fillColor(PDF_COLORS.inkMuted)
        .text(`bobot ${formatPct(k.bobotPct)}`, barX + barW + 48, y + 3, { width: 60, align: "right", lineBreak: false });
      doc.y = y + 15;
    }
    doc.x = PAGE_MARGIN;
    doc.y += 4;
    catatanKecil(doc, "Bar = realisasi kategori terhadap nilai kategorinya; bobot = nilai kategori terhadap total RAB lokasi.");
  }

  /* ── Kelengkapan laporan harian ──────────────────────────────────────── */

  sectionHeading(doc, "Kelengkapan laporan harian");
  if (l.kelengkapan) {
    const k = l.kelengkapan;
    barisKartu(doc, [
      { label: "Hari diharapkan", nilai: String(k.hariDiharapkan), sub: "sejak SPMK s.d. posisi data" },
      { label: "Final", nilai: String(k.final) },
      { label: "Disetujui / dikirim", nilai: `${k.disetujui} / ${k.dikirim}` },
      { label: "Draft / perlu koreksi", nilai: `${k.draft} / ${k.perluKoreksi}`, warna: k.perluKoreksi > 0 ? PDF_COLORS.warningStrong : undefined },
    ]);
    barisKartu(doc, [
      { label: "Hari nihil", nilai: String(k.hariNihil), sub: "dinyatakan tidak ada kegiatan" },
      { label: "Hari tanpa laporan", nilai: String(k.hariTanpaLaporan), warna: k.hariTanpaLaporan > 0 ? PDF_COLORS.danger : PDF_COLORS.success },
      { label: "Laporan terakhir", nilai: k.laporanTerakhirKey ? tgl(k.laporanTerakhirKey) : "belum ada" },
      {
        label: "Sejak laporan terakhir",
        nilai: k.hariSejakLaporanTerakhir == null ? "–" : k.hariSejakLaporanTerakhir === 0 ? "hari ini" : `${k.hariSejakLaporanTerakhir} hari`,
      },
    ]);
  } else {
    paragraph(doc, "Kelengkapan belum bisa dihitung: kontrak belum berjalan (SPMK belum ada).");
    doc.moveDown(0.5);
  }

  /* ── Kendala ─────────────────────────────────────────────────────────── */

  sectionHeading(doc, "Kendala");
  {
    const r = l.kendala.ringkas;
    barisKartu(doc, [
      { label: "Terbuka", nilai: String(r.terbuka), warna: r.terbuka > 0 ? PDF_COLORS.warningStrong : undefined },
      { label: "Kritis", nilai: String(r.kritis), warna: r.kritis > 0 ? PDF_COLORS.danger : undefined },
      { label: "Lewat tenggat", nilai: String(r.lewatTenggat), warna: r.lewatTenggat > 0 ? PDF_COLORS.danger : undefined },
      { label: "Selesai", nilai: String(r.selesai), sub: r.tertuaHari != null ? `terbuka tertua ${r.tertuaHari} hari` : null },
    ]);
    doc.font(PDF_FONT.bold).fontSize(8.5).fillColor(PDF_COLORS.ink).text("Kendala terbuka (terlama dulu)", PAGE_MARGIN, doc.y);
    doc.moveDown(0.3);
    tabel(
      doc,
      ["Kendala", "Tingkat", "Status", "Dibuka", "Umur", "PIC", "Tenggat"],
      l.kendala.terbuka.map((k) => [
        { text: k.judul },
        { text: ISSUE_SEVERITY_LABEL[k.tingkat], color: WARNA_TINGKAT[k.tingkat], bold: k.tingkat === "kritis" },
        { text: k.status },
        { text: tgl(k.dibukaKey) },
        { text: `${k.umurHari} hr`, align: "right" },
        { text: k.pic ?? "–" },
        { text: k.tenggatKey ? `${tgl(k.tenggatKey)}${k.lewatTenggat ? " (lewat)" : ""}` : "–", color: k.lewatTenggat ? PDF_COLORS.danger : undefined },
      ]),
      [3, 1, 1, 1.2, 0.8, 1.4, 1.5],
      { kosong: "Tidak ada kendala terbuka." },
    );
    if (l.kendala.selesaiTerbaru.length > 0) {
      doc.font(PDF_FONT.bold).fontSize(8.5).fillColor(PDF_COLORS.ink).text("Kendala selesai terbaru", PAGE_MARGIN, doc.y);
      doc.moveDown(0.3);
      tabel(
        doc,
        ["Kendala", "Tingkat", "Dibuka", "Ditutup", "Lama"],
        l.kendala.selesaiTerbaru.map((k) => [
          { text: k.judul },
          { text: ISSUE_SEVERITY_LABEL[k.tingkat] },
          { text: tgl(k.dibukaKey) },
          { text: tgl(k.ditutupKey) },
          { text: `${k.umurHari} hr`, align: "right" },
        ]),
        [3.4, 1, 1.3, 1.3, 0.8],
      );
    }
  }

  /* ── Kronologi per babak bulan ───────────────────────────────────────── */

  sectionHeading(doc, "Kronologi");
  catatanKecil(
    doc,
    `${tgl(l.kronologi.sejakKey)} s.d. ${tgl(l.asOfKey)} · ${l.kronologi.totalPeristiwa} peristiwa${l.kronologi.dipotong > 0 ? `, ${l.kronologi.dipotong} peristiwa lampau tidak ditampilkan` : ""} · terbaru dulu.`,
  );
  if (l.kronologi.babak.length === 0) {
    paragraph(doc, "Belum ada kendala maupun kegiatan lapangan yang tercatat.");
    doc.moveDown(0.5);
  }
  for (const b of l.kronologi.babak) {
    ensureSpace(doc, 30);
    doc.font(PDF_FONT.bold).fontSize(9).fillColor(PDF_COLORS.primary).text(s(b.label), PAGE_MARGIN, doc.y);
    doc.moveDown(0.2);
    for (const e of b.peristiwa) {
      const jenis = e.jenis === "kendala_dibuka" ? "Kendala muncul" : e.jenis === "kendala_ditutup" ? "Kendala selesai" : "Kegiatan";
      const warna = e.jenis === "kendala_dibuka" ? PDF_COLORS.danger : e.jenis === "kendala_ditutup" ? PDF_COLORS.success : PDF_COLORS.inkMuted;
      const rincian = e.rincian.length > 0 ? ` – ${e.rincian.join("; ")}` : "";
      doc.font(PDF_FONT.regular).fontSize(8);
      const teks = s(`${jenis}: ${e.judul}${e.berjalan ? " (masih berjalan)" : ""}${e.lewatTenggat ? " (lewat tenggat)" : ""}${rincian}`);
      const h = doc.heightOfString(teks, { width: CONTENT_WIDTH - 70 }) + 4;
      ensureSpace(doc, h);
      const y = doc.y;
      doc.font(PDF_FONT.bold).fontSize(7.5).fillColor(warna).text(tgl(e.tanggal), PAGE_MARGIN, y, { width: 62, lineBreak: false });
      doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLORS.ink).text(teks, PAGE_MARGIN + 68, y, { width: CONTENT_WIDTH - 70 });
      doc.y = Math.max(doc.y, y + h);
    }
    doc.moveDown(0.4);
  }
  doc.x = PAGE_MARGIN;

  /* ── Kegiatan terakhir ───────────────────────────────────────────────── */

  sectionHeading(doc, `Kegiatan lapangan (${l.kegiatan.total} tercatat)`);
  tabel(
    doc,
    ["Tanggal", "Jenis", "Judul", "Status", "Foto"],
    l.kegiatan.terakhir.map((g) => [
      { text: tgl(g.tanggalKey) },
      { text: g.jenis },
      { text: g.judul },
      { text: g.status === "final" ? "Final" : "Draft" },
      { text: String(g.jumlahFoto), align: "center" },
    ]),
    [1.3, 1.6, 3.4, 0.9, 0.7],
    { kosong: "Belum ada kegiatan lapangan tercatat." },
  );

  /* ── Temuan & inspeksi ───────────────────────────────────────────────── */

  sectionHeading(doc, "Temuan pemeriksa & inspeksi");
  {
    const t = l.temuan.ringkas;
    barisKartu(doc, [
      { label: "Temuan terbuka", nilai: `${t.terbuka} / ${t.total}`, warna: t.terbuka > 0 ? PDF_COLORS.warningStrong : undefined },
      { label: "Kritis terbuka", nilai: String(t.kritis), warna: t.kritis > 0 ? PDF_COLORS.danger : undefined },
      { label: "Lewat tenggat", nilai: String(t.lewatTenggat), warna: t.lewatTenggat > 0 ? PDF_COLORS.danger : undefined },
      { label: "Inspeksi", nilai: String(t.inspeksi), sub: t.inspeksiTerakhirKey ? `terakhir ${tgl(t.inspeksiTerakhirKey)}` : "belum ada" },
    ]);
    tabel(
      doc,
      ["Temuan", "Kategori", "Tingkat", "Status", "Tanggal", "Tenggat", "PIC"],
      l.temuan.terbuka.map((t) => [
        { text: t.judul },
        { text: t.kategori },
        { text: ISSUE_SEVERITY_LABEL[t.tingkat], color: WARNA_TINGKAT[t.tingkat], bold: t.tingkat === "kritis" },
        { text: t.statusLabel },
        { text: tgl(t.tanggalKey) },
        { text: t.tenggatKey ? `${tgl(t.tenggatKey)}${t.lewatTenggat ? " (lewat)" : ""}` : "–", color: t.lewatTenggat ? PDF_COLORS.danger : undefined },
        { text: t.penanggungJawab ?? "–" },
      ]),
      [3, 1.1, 0.9, 1.3, 1.2, 1.4, 1.3],
      { kosong: "Tidak ada temuan terbuka." },
    );
  }

  /* ── Administrasi ────────────────────────────────────────────────────── */

  sectionHeading(doc, "Administrasi: milestone, dokumen, surat");
  {
    const a = l.administrasi;
    doc.font(PDF_FONT.bold).fontSize(8.5).fillColor(PDF_COLORS.ink).text("Milestone administrasi per fase", PAGE_MARGIN, doc.y);
    doc.moveDown(0.3);
    tabel(
      doc,
      ["Fase", "Total", "Selesai", "Terlambat"],
      a.milestone.map((m) => [
        { text: m.label },
        { text: String(m.total), align: "center" },
        { text: String(m.selesai), align: "center" },
        { text: String(m.terlambat), align: "center", color: m.terlambat > 0 ? PDF_COLORS.danger : undefined },
      ]),
      [3, 1, 1, 1],
      { kosong: "Belum ada milestone administrasi." },
    );
    barisKartu(doc, [
      { label: "Dokumen aktif", nilai: String(a.dokumen.total) },
      { label: "Kedaluwarsa", nilai: String(a.dokumen.kedaluwarsa), warna: a.dokumen.kedaluwarsa > 0 ? PDF_COLORS.danger : undefined },
      { label: "Segera kedaluwarsa", nilai: String(a.dokumen.segeraKedaluwarsa), warna: a.dokumen.segeraKedaluwarsa > 0 ? PDF_COLORS.warningStrong : undefined },
      { label: "Surat masuk / keluar", nilai: `${a.surat.masuk} / ${a.surat.keluar}`, sub: `${a.surat.perluBalas} perlu balas, ${a.surat.lewatTenggatBalas} lewat tenggat` },
    ]);
    if (a.dokumen.perFase.length > 0) {
      catatanKecil(doc, `Dokumen per fase: ${a.dokumen.perFase.map((f) => `${f.label} ${f.jumlah}`).join(" · ")}.`);
    }
    if (a.surat.terakhir.length > 0) {
      tabel(
        doc,
        ["Arah", "Tanggal", "Perihal"],
        a.surat.terakhir.map((sr) => [
          { text: sr.arah === "masuk" ? "Masuk" : "Keluar" },
          { text: tgl(sr.tanggalKey) },
          { text: sr.perihal },
        ]),
        [0.8, 1.2, 5],
      );
    }
  }

  /* ── Perhatian EWS ───────────────────────────────────────────────────── */

  sectionHeading(doc, "Perhatian (peringatan dini)");
  if (l.perhatian.length === 0) {
    paragraph(doc, "Tidak ada peringatan dini yang terpicu untuk lokasi dan paket ini.");
    doc.moveDown(0.5);
  }
  l.perhatian.forEach((w, i) => {
    doc.font(PDF_FONT.regular).fontSize(8);
    const isi = s(`${w.alasan} Tindakan: ${w.tindakan}`);
    const h = doc.heightOfString(isi, { width: CONTENT_WIDTH - 24 }) + 16;
    ensureSpace(doc, h + 4);
    const y = doc.y;
    doc.rect(PAGE_MARGIN, y, 3, h).fill(WARNA_SEVERITY[w.severity]);
    doc
      .font(PDF_FONT.bold)
      .fontSize(8)
      .fillColor(WARNA_SEVERITY[w.severity])
      .text(s(`${i + 1}. ${EWS_SEVERITY_LABEL[w.severity].toUpperCase()} · ${EWS_KATEGORI_LABEL[w.kategori]} · ${w.objek}`), PAGE_MARGIN + 10, y + 2, { width: CONTENT_WIDTH - 24, lineBreak: false });
    doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLORS.ink).text(isi, PAGE_MARGIN + 10, y + 13, { width: CONTENT_WIDTH - 24 });
    doc.y = y + h + 4;
    doc.x = PAGE_MARGIN;
  });

  /* ── Rencana minggu depan ────────────────────────────────────────────── */

  sectionHeading(doc, "Rencana minggu depan");
  if (l.rencanaMingguDepan) {
    const r = l.rencanaMingguDepan;
    catatanKecil(doc, `Minggu ke-${r.mingguKe}${r.catatan ? ` · ${r.catatan}` : ""}`);
    tabel(
      doc,
      ["Pekerjaan", "Satuan", "Target volume"],
      r.item.map((it) => [
        { text: it.nama },
        { text: it.unit ?? "–", align: "center" },
        { text: it.targetVolume.toLocaleString("id-ID", { maximumFractionDigits: 3 }), align: "right" },
      ]),
      [4, 1, 1.4],
    );
  } else {
    paragraph(doc, "Rencana minggu berikutnya belum diisi di MARLIN.");
    doc.moveDown(0.5);
  }

  /* ── Foto ────────────────────────────────────────────────────────────── */

  sectionHeading(doc, `Dokumentasi foto (${l.foto.total} foto tersimpan)`);
  if (fotoTerpilih.length === 0) {
    paragraph(doc, "Belum ada foto dari laporan harian terhitung atau kegiatan final.");
    doc.moveDown(0.5);
  } else {
    const gap = 8;
    const fw = (CONTENT_WIDTH - gap) / 2;
    const fh = fw * 0.68;
    for (let i = 0; i < fotoTerpilih.length; i += 2) {
      ensureSpace(doc, fh + 26);
      const y = doc.y;
      for (let j = 0; j < 2 && i + j < fotoTerpilih.length; j++) {
        const f = fotoTerpilih[i + j];
        const x = PAGE_MARGIN + j * (fw + gap);
        const uri = gambar[i + j];
        if (uri) {
          try {
            doc.image(uri, x, y, { fit: [fw, fh], align: "center", valign: "center" });
          } catch {
            placeholderFoto(doc, x, y, fw, fh);
          }
        } else {
          placeholderFoto(doc, x, y, fw, fh);
        }
        doc.rect(x, y, fw, fh).lineWidth(0.5).strokeColor(PDF_COLORS.border).stroke();
        doc
          .font(PDF_FONT.regular)
          .fontSize(7)
          .fillColor(PDF_COLORS.inkMuted)
          .text(s(`${f.tanggalKey ? tgl(f.tanggalKey) : "tanpa tanggal"}${f.keterangan ? ` · ${f.keterangan}` : ""}`), x, y + fh + 3, { width: fw, lineBreak: false, ellipsis: true });
      }
      doc.y = y + fh + 18;
      doc.x = PAGE_MARGIN;
    }
  }

  /* ── Lampiran: keterbatasan & sumber ─────────────────────────────────── */

  sectionHeading(doc, "Keterbatasan data");
  if (l.limitations.length === 0) paragraph(doc, "Tidak ada keterbatasan yang perlu dicatat.");
  for (const lim of l.limitations) {
    ensureSpace(doc, 14);
    doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLORS.ink).text(s(`• ${lim}`), PAGE_MARGIN + 4, doc.y, { width: CONTENT_WIDTH - 8 });
  }
  doc.moveDown(0.5);
  sectionHeading(doc, "Sumber data");
  if (l.sumber.length === 0) paragraph(doc, "–");
  for (const r of l.sumber.slice(0, 80)) {
    ensureSpace(doc, 12);
    doc
      .font(PDF_FONT.regular)
      .fontSize(7)
      .fillColor(PDF_COLORS.inkMuted)
      .text(s(`${r.label}${r.value ? ` – ${r.value}` : ""}${r.href ? ` (${r.href})` : ""}`), PAGE_MARGIN + 4, doc.y, { width: CONTENT_WIDTH - 8 });
  }
  if (l.sumber.length > 80) catatanKecil(doc, `… dan ${l.sumber.length - 80} sumber lain.`);

  stampFooters(doc, `${appName} – Laporan lengkap ${s(id.nama)} s.d. ${l.asOfKey} · dibuat ${formatTanggal(new Date(l.dibuatPada), "d MMM yyyy HH.mm")} WIB`);
  return docToBuffer(doc);
}

function placeholderFoto(doc: PdfDoc, x: number, y: number, w: number, h: number): void {
  doc.rect(x, y, w, h).fill(PDF_COLORS.primary50);
  doc
    .font(PDF_FONT.regular)
    .fontSize(8)
    .fillColor(PDF_COLORS.inkFaint)
    .text("Foto tidak dapat dimuat", x, y + h / 2 - 5, { width: w, align: "center", lineBreak: false });
}
