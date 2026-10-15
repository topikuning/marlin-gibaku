import "server-only";
import type { KurvaPaketDokumen } from "@/lib/laporan/kurva-paket";
import { penandatanganDokumen, peranSlot, type JenisDokumen } from "@/lib/laporan/penandatangan";
import { getBranding } from "@/lib/branding";
import { getPeriodBounds, getPeriodReport, type PeriodKind, type PeriodReport } from "@/lib/periodic-report";
import { buildKurvaSheet } from "@/lib/scurve/kkp-sheet";
import { formatTanggal } from "@/lib/format";
import { keteranganDeviasi } from "@/lib/plan/rencana-format";
import { kopProgresMingguan } from "@/lib/laporan/kop-progres";
import { susunRencanaRealisasi } from "@/lib/laporan/rencana-realisasi-kategori";
import { muatLogoLaporan, type LogoLaporan } from "@/lib/export/logo-laporan";
import { PDF_COLORS, PDF_FONT, docToBuffer, createLandscapeA4Doc, LANDSCAPE_MARGIN, type PdfDoc } from "./document";
import { GRID_HEAD_BG, GRID_LINE, colWidths, gridRow, gridRowHeight, type GridCell, type GridOptions } from "./grid";
import { blokTandaTanganPdf, muatTtdPdf, TANPA_TTD_PDF, type TtdPdf } from "./ttd-gambar";

/**
 * Laporan Mingguan/Bulanan format KKP — BLANKO RESMI, bukan ringkasan naratif.
 *
 * Halaman 1 = sheet KURVA S (matriks bobot kategori × minggu + baris prestasi +
 * garis kurva rencana/realisasi + skala KETERANGAN), cermin komponen layar
 * `ScurveKkpSheet`. Halaman 2+ = blanko rincian, cermin `KkpPeriodReport`:
 * kop → identitas → rincian per kategori/item (header 3 baris berkelompok) →
 * ringkasan bobot → tenaga/material/alat → kendala → tanda tangan.
 *
 * Angka diambil dari `getPeriodReport` + `buildKurvaSheet` — sumber yang SAMA
 * dengan layar, halaman cetak, dan Excel (DECISIONS 161). A4 lanskap karena
 * tabel rincian punya 17 kolom dan matriks kurva bisa >20 minggu.
 */

// Angka dokumen resmi memakai format Indonesia (koma desimal, titik ribuan).
const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const fx = (d: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
const f1 = fx(1);
const f2 = fx(2);
const f3 = fx(3);
const rupiah = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
const p1 = (n: number) => `${f1.format(n)}%`;
const p2 = (n: number) => f2.format(n);
const dash = (n: number) => (n > 0 ? volFmt.format(n) : "–");

export type PeriodikKkpPdfResult = { buffer: Buffer };

export async function buildPeriodikKkpPdf(
  r: PeriodReport,
  appName: string,
  /** Gambar tanda tangan & stempel (DECISIONS 328); null = ruang kosong. */
  gambarTtd?: TtdPdf | null,
  /** Logo kop halaman progres mingguan (DECISIONS 671); null = kotak tanpa logo. */
  logo?: LogoLaporan | null,
): Promise<Buffer> {
  const kindLabel = r.kind === "mingguan" ? "MINGGU" : "BULAN";
  const periodeLabel = r.kind === "mingguan" ? "Minggu" : "Bulan";
  return susunPdfPeriodik(r, appName, gambarTtd, {
    judulBerkas: `Laporan ${periodeLabel} ke-${r.n} – ${r.header.locationName}`,
    judulKurva: `KURVA S ${kindLabel} KE - ${r.n}`,
    periode: { start: r.header.periodeStart, end: r.header.periodeEnd },
    catatan: null,
    // Lembar kurva di sini BAGIAN laporan periodik – diteken penanda tangan
    // laporannya, bukan penanda tangan dokumen jadwal (DECISIONS 403).
    jenis: r.kind,
    rincian: true,
    logo: logo ?? null,
  });
}

/**
 * TIME SCHEDULE (KURVA-S) BERDIRI SENDIRI – cermin halaman `/cetak/jadwal`.
 *
 * Lembar kurvanya sama persis dengan halaman 1 laporan periodik (fungsi gambar
 * yang sama), dengan tiga beda yang juga ada di layar: judulnya, periodenya =
 * seluruh masa kontrak, dan penanda tangannya = penanda tangan DOKUMEN JADWAL
 * (DECISIONS 402/403). Halaman rincian TIDAK ikut – itu laporan mingguan, bukan
 * jadwal.
 *
 * Ada supaya aplikasi terpasang (PWA) punya berkas untuk dibuka/dicetak:
 * `window.print()` sering tidak bekerja di sana (laporan user 2026-10-11).
 */
export async function buildJadwalKkpPdf(
  r: PeriodReport,
  appName: string,
  gambarTtd: TtdPdf | null,
  opsi: {
    periode: { start: Date; end: Date };
    /** Catatan di bawah judul – mis. asumsi tanggal mulai sebelum SPMK. */
    catatan: string | null;
  },
): Promise<Buffer> {
  return susunPdfPeriodik(r, appName, gambarTtd, {
    judulBerkas: `Time Schedule – ${r.header.locationName}`,
    judulKurva: JUDUL_JADWAL,
    periode: opsi.periode,
    catatan: opsi.catatan,
    jenis: "jadwal",
    rincian: false,
  });
}

/**
 * KURVA-S PAKET – gabungan seluruh lokasi (DECISIONS 678). Lembar yang sama
 * dengan Time Schedule lokasi; barisnya lokasi (bobot = porsi RAB), dirakit
 * `susunKurvaPaket`.
 */
export async function buildKurvaPaketPdf(
  r: PeriodReport,
  appName: string,
  gambarTtd: TtdPdf | null,
  opsi: { periode: { start: Date; end: Date }; catatan: string | null },
): Promise<Buffer> {
  return susunPdfPeriodik(r, appName, gambarTtd, {
    judulBerkas: `Kurva S Paket – ${r.header.packageName}`,
    judulKurva: JUDUL_KURVA_PAKET,
    periode: opsi.periode,
    catatan: opsi.catatan,
    jenis: "jadwal",
    rincian: false,
    labelNilai: "Nilai Fisik Seluruh Lokasi",
    labelUraian: "Lokasi",
    tinggiPlotMin: 230,
  });
}

export const JUDUL_KURVA_PAKET = "KURVA S PAKET – RENCANA & REALISASI GABUNGAN SELURUH LOKASI";

/** Judul dokumen jadwal – SAMA dengan halaman `/cetak/jadwal`. */
const JUDUL_JADWAL = "TIME SCHEDULE (KURVA S) – RENCANA & REALISASI";

async function susunPdfPeriodik(
  r: PeriodReport,
  appName: string,
  gambarTtd: TtdPdf | null | undefined,
  opsi: {
    judulBerkas: string;
    judulKurva: string;
    periode: { start: Date; end: Date };
    catatan: string | null;
    jenis: JenisDokumen;
    /** false = lembar kurva saja (dokumen jadwal). */
    rincian: boolean;
    logo?: LogoLaporan | null;
    /** Kurva-S paket (DECISIONS 678): barisnya lokasi, nilainya Σ lokasi. */
    labelNilai?: string;
    labelUraian?: string;
    /**
     * Tinggi minimum area kurva (pt). Garis kurva digambar di atas baris
     * kategori; dokumen paket hanya punya beberapa baris lokasi, dan tanpa ini
     * kurva 0–100% terjepit di ±50 pt. Hanya mengisi ruang yang tersisa di
     * halaman, tidak pernah mendorong tanda tangan ke halaman berikut.
     */
    tinggiPlotMin?: number;
  },
): Promise<Buffer> {
  const periodeLabel = r.kind === "mingguan" ? "Minggu" : "Bulan";
  const doc = createLandscapeA4Doc({ title: opsi.judulBerkas });
  const x = LANDSCAPE_MARGIN;
  const width = doc.page.width - LANDSCAPE_MARGIN * 2;
  const bottom = doc.page.height - LANDSCAPE_MARGIN - 14;
  const h = r.header;
  let y = LANDSCAPE_MARGIN;

  // Paginasi diatur manual (sama seperti harian-kkp) — matikan auto-break pdfkit
  // supaya teks dekat margin bawah tidak memicu halaman kosong.
  const noAutoBreak = () => {
    doc.page.margins.bottom = 0;
  };
  noAutoBreak();
  const newPage = () => {
    doc.addPage();
    noAutoBreak();
    y = LANDSCAPE_MARGIN;
  };
  const fit = (need: number, repeatHeader?: () => void) => {
    if (y + need <= bottom) return;
    newPage();
    repeatHeader?.();
  };
  const draw = (cells: GridCell[], o: GridOptions) => {
    fit(gridRowHeight(doc, cells, o));
    y = gridRow(doc, y, cells, o);
  };
  const centerText = (text: string, size: number, bold: boolean, gap = 2) => {
    doc
      .font(bold ? PDF_FONT.bold : PDF_FONT.regular)
      .fontSize(size)
      .fillColor(PDF_COLORS.ink)
      .text(text, x, y, { width, align: "center", lineBreak: false });
    y += size + gap;
  };

  /* ═════ HALAMAN 1 — KURVA S ═════════════════════════════════════════════ */
  centerText(opsi.judulKurva, 12, true);
  centerText(
    `Periode tanggal ${formatTanggal(opsi.periode.start)} s/d ${formatTanggal(opsi.periode.end)}`,
    8,
    true,
    6,
  );
  if (opsi.catatan) {
    // Tinggi DIUKUR: catatan bisa membungkus dua baris.
    doc.font(PDF_FONT.regular).fontSize(7.5).fillColor(PDF_COLORS.ink);
    const tinggi = doc.heightOfString(opsi.catatan, { width });
    doc.text(opsi.catatan, x, y, { width });
    y += tinggi + 4;
  }

  // Identitas dua kolom (kiri identitas paket, kanan masa/tahun + legenda garis).
  const identOpt: GridOptions = { x, width, cols: colWidths(width, [1.1, 2.6, 1.1, 2.2]), fontSize: 7.5 };
  draw(
    [
      { text: "Paket Pekerjaan", head: true },
      { text: h.packageName },
      { text: "Masa Pelaksanaan", head: true },
      { text: `${h.masaPelaksanaanHari} Hari Kalender` },
    ],
    identOpt,
  );
  draw(
    [
      { text: "Lokasi", head: true },
      { text: `${h.village}${h.district ? `, Kec. ${h.district}` : ""}, ${h.regency}` },
      { text: "Tahun Anggaran", head: true },
      { text: String(h.tahunAnggaran) },
    ],
    identOpt,
  );
  draw(
    [
      { text: opsi.labelNilai ?? "Nilai Fisik Lokasi", head: true },
      { text: rupiah(Number(h.locationValue)) },
      { text: "Nomor Kontrak", head: true },
      { text: h.contractNumber || "-" },
    ],
    identOpt,
  );
  y += 4;

  const sheet = buildKurvaSheet({
    categories: r.kurvaSchedule,
    totalWeeks: r.totalWeeks,
    contractStart: h.contractStart,
    weekMode: h.weekMode,
    contractEnd: h.contractEnd,
    actualCum: r.scurve.actualPct,
    currentWeek: r.scurve.currentWeek,
    planCumOfficial: r.scurve.planPct,
  });
  const N = sheet.totalWeeks;
  // Kolom minggu menyempit saat periode panjang; font ikut mengecil supaya
  // angka 3 desimal tetap terbaca tanpa terpotong.
  const kurvaFont = N > 26 ? 4.6 : N > 18 ? 5.2 : 6;
  const weekWeight = 1;
  const kurvaCols = colWidths(width, [0.6, 4.2, 0.9, ...Array.from({ length: N }, () => weekWeight), 0.9]);
  let kurvaOpt: GridOptions = { x, width, cols: kurvaCols, fontSize: kurvaFont };

  // Header 2 baris: kelompok bulan (span) + M1..MN.
  const monthCells: GridCell[] = [
    { text: "No", head: true, align: "center" },
    { text: opsi.labelUraian ?? "Uraian Pekerjaan", head: true, align: "center" },
    { text: "Bobot (%)", head: true, align: "center" },
    ...sheet.monthGroups.map((g): GridCell => ({ text: g.label, head: true, align: "center", span: g.span })),
    { text: "KET", head: true, align: "center" },
  ];
  const weekCells: GridCell[] = [
    { text: "", head: true },
    { text: "", head: true },
    { text: "", head: true },
    // Rentang tanggal tiap minggu ikut tercetak (user 2026-08-24) — batasnya
    // mengikuti mode periode minggu kontrak (M1 bisa pendek pada mode
    // Senin–Minggu).
    ...Array.from({ length: N }, (_, i): GridCell => ({
      text: `M${i + 1}\n${sheet.weekRanges[i] ?? ""}`,
      head: true,
      align: "center",
    })),
    { text: "", head: true },
  ];
  const kurvaHead = () => {
    y = gridRow(doc, y, monthCells, kurvaOpt);
    y = gridRow(doc, y, weekCells, kurvaOpt);
  };

  const barisKategori = sheet.categories.map((c): GridCell[] => [
    { text: c.code, align: "center" },
    { text: c.name, bold: true },
    { text: p2(c.bobotShown), align: "center" },
    ...c.weeklyShown.map((v): GridCell => ({ text: v > 0 ? f3.format(v) : "", align: "right" })),
    { text: "", align: "center" },
  ]);
  // Baris prestasi (rencana/realisasi kumulatif + deviasi).
  const prestasiRows: [string, (number | null)[], boolean][] = [
    ["Rencana Prestasi %", sheet.rencanaPerWeek, false],
    ["Kumulatif Rencana Prestasi %", sheet.kumulatifRencana, true],
    ["Realisasi Prestasi %", sheet.realisasiPerWeek, false],
    ["Kumulatif Realisasi Prestasi %", sheet.kumulatifRealisasi, true],
    ["Deviasi +/-", sheet.deviasi, true],
  ];
  const barisPrestasi = prestasiRows.map(([label, arr, bold]): GridCell[] => [
    { text: label, span: 2, align: "right", bold },
    { text: label.startsWith("Kumulatif Rencana") ? p2(sheet.totalBobotShown) : "", align: "center", bold },
    // Tanpa akhiran "%" — label barisnya sudah menyebut %, dan sufiks itu
    // membuat "100,00%" terbungkus dua baris di kolom minggu yang sempit.
    ...arr.map((v): GridCell => ({ text: v == null ? "" : f2.format(v), align: "right", bold })),
    { text: "", align: "center" },
  ]);
  /*
   * Lembar kurva + tanda tangannya SATU halaman, seperti blanko KKP. RAB
   * dengan banyak kategori (17+) dulu mendorong tanda tangan ke halaman 2
   * sendirian; kini baris dirapatkan bertahap sampai muat. Kalau tetap tidak
   * muat (puluhan kategori), tabel mengalir ke halaman berikut seperti biasa.
   */
  const TINGGI_TTD = 8 + 100;
  const tinggiLembar = (o: GridOptions) =>
    [monthCells, weekCells, ...barisKategori, ...barisPrestasi].reduce((t, c) => t + gridRowHeight(doc, c, o), 0);
  for (const rapat of [
    { padY: 1.5, minRowHeight: 10 },
    { padY: 1, minRowHeight: 8, fontSize: kurvaFont - 0.6 },
  ]) {
    if (y + tinggiLembar(kurvaOpt) + TINGGI_TTD <= bottom) break;
    kurvaOpt = { ...kurvaOpt, ...rapat };
  }
  let optKategori = kurvaOpt;
  if (opsi.tinggiPlotMin && barisKategori.length > 0) {
    const kini = barisKategori.reduce((t, c) => t + gridRowHeight(doc, c, kurvaOpt), 0);
    const sisa = bottom - y - tinggiLembar(kurvaOpt) - TINGGI_TTD;
    const target = Math.min(opsi.tinggiPlotMin, kini + Math.max(0, sisa));
    if (target > kini) optKategori = { ...kurvaOpt, minRowHeight: target / barisKategori.length };
  }
  kurvaHead();

  // Baris kategori — sekaligus catat rentang vertikal untuk overlay kurva.
  const plotTop = y;
  for (const cells of barisKategori) {
    fit(gridRowHeight(doc, cells, optKategori), kurvaHead);
    y = gridRow(doc, y, cells, optKategori);
  }
  const plotBottom = y;

  for (const cells of barisPrestasi) {
    fit(gridRowHeight(doc, cells, kurvaOpt));
    y = gridRow(doc, y, cells, kurvaOpt);
  }

  // Skala KETERANGAN 0–100% kotak-kotak hitam-putih di kolom paling kanan,
  // sejajar rentang vertikal kurva — sama dengan blanko & tampilan layar.
  drawKetScale(doc, {
    left: x + kurvaCols.slice(0, kurvaCols.length - 1).reduce((s2, w) => s2 + w, 0),
    colWidth: kurvaCols[kurvaCols.length - 1],
    top: plotTop,
    height: plotBottom - plotTop,
  });

  // Overlay garis kurva-S di atas blok baris kategori (x menembus kolom minggu).
  drawCurveOverlay(doc, {
    left: x + kurvaCols[0] + kurvaCols[1] + kurvaCols[2],
    top: plotTop,
    plotWidth: kurvaCols.slice(3, 3 + N).reduce((s, w) => s + w, 0),
    plotHeight: plotBottom - plotTop,
    plan: sheet.kumulatifRencana,
    actual: sheet.kumulatifRealisasi,
  });

  y += 8;
  signatureBlock(doc, { x, width, getY: () => y, h, fit: (need) => fit(need), setY: (v) => (y = v), gambarTtd, jenis: opsi.jenis });

  if (!opsi.rincian) {
    catatanKaki(doc, appName, width);
    return docToBuffer(doc);
  }

  /* ═════ LAPORAN PROGRES MINGGUAN per kategori (DECISIONS 670) ══════════ */
  if (r.kind === "mingguan") {
    newPage();
    // Kop sama dengan web & Excel – teksnya dari `kopProgresMingguan`
    // (DECISIONS 671): identitas di kiri, minggu/periode + tiga logo di kanan.
    const kop = kopProgresMingguan(h, r.n);
    centerText(kop.judul, 13, true, 5);
    const yKop = y;
    const lebarKiri = width * 0.6;
    doc.font(PDF_FONT.bold).fontSize(7.5).fillColor(PDF_COLORS.ink);
    // Lebar label dari label terpanjang – "Nilai Kontrak Fisik (Paket)"
    // terlipat di kolom tetap 108 pt dan menimpa baris di bawahnya (DECISIONS 677).
    const kolLabel = Math.max(108, ...kop.identitas.map(([k]) => doc.widthOfString(k) + 6));
    const kolTitik = 9;
    const lebarNilai = lebarKiri - kolLabel - kolTitik;
    let yKiri = yKop;
    for (const [k, v] of kop.identitas) {
      const tinggi = doc.heightOfString(v, { width: lebarNilai });
      doc.text(k, x, yKiri, { width: kolLabel, lineBreak: false });
      doc.text(":", x + kolLabel, yKiri, { width: kolTitik, lineBreak: false });
      doc.text(v, x + kolLabel + kolTitik, yKiri, { width: lebarNilai });
      yKiri += Math.max(10, tinggi + 1.5);
    }
    const xKanan = x + width * 0.63;
    const lebarKanan = width - width * 0.63;
    let yKanan = yKop;
    doc.font(PDF_FONT.bold).fontSize(9);
    doc.text(kop.minggu, xKanan, yKanan, { width: lebarKanan, align: "center", lineBreak: false });
    yKanan += 13;
    doc.text(kop.periode, xKanan, yKanan, { width: lebarKanan, align: "center", lineBreak: false });
    yKanan += 12;
    doc.save().moveTo(xKanan, yKanan).lineTo(xKanan + lebarKanan, yKanan).lineWidth(0.6).strokeColor(PDF_COLORS.ink).stroke().restore();
    yKanan += 2;
    const lebarPihak = lebarKanan / 3;
    const TINGGI_LOGO = 44;
    const gambarPihak = [opsi.logo?.kontraktor, opsi.logo?.konsultan, opsi.logo?.pemilik];
    kop.pihak.forEach((pihak, i) => {
      const xp = xKanan + i * lebarPihak;
      doc.font(PDF_FONT.bold).fontSize(7).fillColor(PDF_COLORS.ink);
      doc.text(pihak, xp, yKanan, { width: lebarPihak, align: "center", lineBreak: false });
      const g = gambarPihak[i];
      if (!g) return;
      const skala = Math.min(TINGGI_LOGO / g.height, (lebarPihak - 12) / g.width);
      const [w, t] = [g.width * skala, g.height * skala];
      // ArrayBuffer, bukan Buffer: pdfkit membaca Buffer dari realm lain
      // sebagai NAMA BERKAS (pola yang sama di `ttd-gambar.ts`).
      const ab = g.buffer.buffer.slice(g.buffer.byteOffset, g.buffer.byteOffset + g.buffer.byteLength) as ArrayBuffer;
      try {
        doc.image(ab, xp + (lebarPihak - w) / 2, yKanan + 10 + (TINGGI_LOGO - t) / 2, { width: w, height: t });
      } catch {
        // Logo rusak = kotak tanpa logo, bukan PDF yang gagal terbit.
      }
    });
    yKanan += 10 + TINGGI_LOGO + 4;
    y = Math.max(yKiri, yKanan) + 6;

    const prog: GridOptions = {
      x,
      width,
      cols: colWidths(width, [0.55, 4.3, 1.45, 0.75, 0.8, 0.75, 0.8, 0.75, 0.8, 0.75, 0.85, 0.8, 0.75]),
      fontSize: 6.6,
    };
    /*
     * Kepala tabel 3 baris dengan sel TERGABUNG (NO, JENIS PEKERJAAN, … setinggi
     * tiga baris) seperti contoh – `gridRow` tidak mengenal rowspan, jadi
     * kotaknya digambar langsung.
     */
    const xKol = prog.cols.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [x]);
    const TINGGI_KEPALA = [14, 12, 12];
    const kepala: [number, number, number, number, string][] = [
      [0, 0, 0, 2, "NO"],
      [1, 1, 0, 2, "JENIS PEKERJAAN"],
      [2, 2, 0, 2, "NILAI PEKERJAAN (Rp)"],
      [3, 3, 0, 2, "BOBOT (%)"],
      [4, 9, 0, 0, "REALISASI PEKERJAAN"],
      [4, 5, 1, 1, "MINGGU LALU"],
      [6, 7, 1, 1, "MINGGU INI"],
      [8, 9, 1, 1, "s/d MINGGU INI"],
      ...[4, 6, 8].flatMap((c): [number, number, number, number, string][] => [
        [c, c, 2, 2, "PROGRES"],
        [c + 1, c + 1, 2, 2, "BOBOT"],
      ]),
      [10, 10, 0, 2, "BOBOT RENCANA s/d MINGGU INI"],
      [11, 12, 0, 0, "SISA PEKERJAAN"],
      [11, 12, 1, 1, "s/d MINGGU INI"],
      [11, 11, 2, 2, "PROGRES"],
      [12, 12, 2, 2, "BOBOT"],
    ];
    const progHead = () => {
      const yBaris = TINGGI_KEPALA.reduce<number[]>((acc, t) => [...acc, acc[acc.length - 1] + t], [y]);
      doc.font(PDF_FONT.bold).fontSize(prog.fontSize ?? 6.6);
      for (const [c0, c1, r0, r1, teks] of kepala) {
        const [kx, ky, kw, kt] = [xKol[c0], yBaris[r0], xKol[c1 + 1] - xKol[c0], yBaris[r1 + 1] - yBaris[r0]];
        doc.rect(kx, ky, kw, kt).fill(GRID_HEAD_BG);
        doc.rect(kx, ky, kw, kt).lineWidth(0.5).strokeColor(GRID_LINE).stroke();
        const tinggiTeks = doc.heightOfString(teks, { width: kw - 4 });
        doc.fillColor(PDF_COLORS.inkMuted).text(teks, kx + 2, ky + (kt - tinggiTeks) / 2, { width: kw - 4, align: "center" });
      }
      y = yBaris[yBaris.length - 1];
    };
    progHead();
    const b3 = (v: number) => (Math.abs(v) < 0.0005 ? "–" : f3.format(v));
    const pr = (v: number) => (Math.abs(v) < 0.005 ? "–" : `${f2.format(v)}%`);
    const angkaBaris = (
      b: PeriodReport["progresKategoriTotal"],
      bold: boolean,
      // Baris JUMLAH menulis bobot lengkap walau nol, bukan "–".
      bb: (v: number) => string = b3,
    ): GridCell[] => [
      { text: new Intl.NumberFormat("id-ID").format(Math.round(b.nilai)), align: "right", bold },
      { text: f3.format(b.bobot), align: "right", bold },
      { text: pr(b.progresLalu), align: "right", bold },
      { text: bb(b.bobotLalu), align: "right", bold },
      { text: pr(b.progresIni), align: "right", bold },
      { text: bb(b.bobotIni), align: "right", bold },
      { text: pr(b.progresSd), align: "right", bold },
      { text: bb(b.bobotSd), align: "right", bold },
      { text: bb(b.bobotRencana), align: "right", bold },
      { text: pr(b.sisaProgres), align: "right", bold },
      { text: bb(b.sisaBobot), align: "right", bold },
    ];
    const jeda: GridCell[] = Array.from({ length: 13 }, () => ({ text: "" }));
    for (const b of r.progresKategori) {
      const satu = b.tingkat === 1;
      // Baris jeda sebelum tiap kategori – seperti contoh Lampiran Termin.
      const angka = angkaBaris(b, satu).map((c) => ({ ...c, text: b.judulSaja ? "" : c.text }));
      const cells: GridCell[] = [
        { text: b.code, align: satu ? "center" : "left", bold: satu, bg: satu ? PDF_COLORS.primary50 : undefined },
        { text: satu ? b.name : `   ${b.name}`, bold: satu, bg: satu ? PDF_COLORS.primary50 : undefined },
        ...angka.map((c) => ({ ...c, bg: satu ? PDF_COLORS.primary50 : undefined })),
      ];
      // Jeda + baris kategori tidak dipisah halaman (jeda yatim di dasar halaman).
      const tinggiJeda = satu ? gridRowHeight(doc, jeda, prog) : 0;
      fit(tinggiJeda + gridRowHeight(doc, cells, prog), progHead);
      if (satu) y = gridRow(doc, y, jeda, prog);
      y = gridRow(doc, y, cells, prog);
    }
    const tot: GridCell[] = [
      { text: "JUMLAH", span: 2, align: "right", bold: true },
      ...angkaBaris(r.progresKategoriTotal, true, (v) => f3.format(v)),
    ];
    fit(gridRowHeight(doc, tot, prog), progHead);
    y = gridRow(doc, y, tot, prog);
    y += 6;

    const ringkas: GridOptions = {
      x: x + width * 0.45,
      width: width * 0.55,
      cols: colWidths(width * 0.55, [2.2, 0.8, 1.2]),
      fontSize: 7.5,
    };
    fit(4 * 13);
    const dev = r.deviationPct;
    // Tanpa bingkai – sama dengan contoh, web, dan Excel.
    const [wLabel, wNilai] = ringkas.cols;
    doc.font(PDF_FONT.bold).fontSize(ringkas.fontSize ?? 7.5).fillColor(PDF_COLORS.ink);
    for (const [k, v, ket] of [
      ["BOBOT REALISASI MINGGU INI", `${f3.format(r.totals.bobotIni)} %`, ""],
      ["BOBOT REALISASI s/d MINGGU INI", `${f3.format(r.totals.bobotSd)} %`, ""],
      ["BOBOT RENCANA s/d MINGGU INI", `${f3.format(r.planPct)} %`, ""],
      ["DEVIASI (+/-)", `${dev > 0.005 ? "+" : ""}${f3.format(dev)} %`, `( ${keteranganDeviasi(dev)} )`],
    ] as [string, string, string][]) {
      doc.text(k, ringkas.x, y, { width: wLabel - 4, align: "right", lineBreak: false });
      doc.text(v, ringkas.x + wLabel, y, { width: wNilai - 4, align: "right", lineBreak: false });
      if (ket) doc.text(ket, ringkas.x + wLabel + wNilai + 4, y, { width: ringkas.cols[2] - 4, lineBreak: false, oblique: true });
      y += 11;
    }
    y += 8;
    signatureBlock(doc, { x, width, getY: () => y, h, fit: (need) => fit(need), setY: (v) => (y = v), gambarTtd, jenis: r.kind });
  }

  /* ═════ HALAMAN 2+ — BLANKO RINCIAN ════════════════════════════════════ */
  newPage();
  centerText(r.kind === "mingguan" ? "LAPORAN MINGGUAN PEKERJAAN" : "LAPORAN BULANAN PEKERJAAN", 12, true);
  centerText(`${periodeLabel} Ke-${r.n} dari ${r.maxN}`, 9, true);
  centerText(
    `Periode ${formatTanggal(h.periodeStart)} s/d ${formatTanggal(h.periodeEnd)}`,
    8,
    false,
    6,
  );
  draw(
    [
      { text: "Paket Pekerjaan", head: true },
      { text: h.packageName },
      { text: "Masa Pelaksanaan", head: true },
      { text: `${h.masaPelaksanaanHari} Hari Kalender` },
    ],
    identOpt,
  );
  draw(
    [
      { text: "Lokasi", head: true },
      { text: `${h.locationName} – ${h.village}${h.district ? `, Kec. ${h.district}` : ""}, ${h.regency}, ${h.province}` },
      { text: "Nilai Fisik Lokasi", head: true },
      { text: rupiah(Number(h.locationValue)) },
    ],
    identOpt,
  );
  draw(
    [
      { text: "Nomor Kontrak", head: true },
      { text: h.contractNumber || "-" },
      { text: "Kontraktor Pelaksana", head: true },
      { text: h.vendorName },
    ],
    identOpt,
  );
  y += 6;

  sectionTitle(doc, "1. Rincian Capaian per Item Pekerjaan", x, () => y, (v) => (y = v));

  // Header 3 baris berkelompok — sama dengan blanko KKP & sheet Excel.
  const rinci: GridOptions = {
    x,
    width,
    cols: colWidths(width, [0.45, 4, 0.95, 0.75, 0.7, 0.85, 0.8, 0.7, 0.85, 0.8, 0.7, 0.85, 0.8, 0.7, 0.8, 0.8, 0.9]),
    fontSize: 6.2,
  };
  const rinciHead = () => {
    y = gridRow(
      doc,
      y,
      [
        { text: "No", head: true, align: "center" },
        { text: "Uraian Pekerjaan", head: true, align: "center" },
        { text: "Volume Kontrak", head: true, align: "center" },
        { text: "Satuan", head: true, align: "center" },
        { text: "Bobot", head: true, align: "center" },
        { text: "Realisasi Pekerjaan", head: true, align: "center", span: 9 },
        { text: "Bobot Rencana", head: true, align: "center" },
        { text: "Sisa Pekerjaan", head: true, align: "center", span: 2 },
      ],
      rinci,
    );
    y = gridRow(
      doc,
      y,
      [
        { text: "", head: true, span: 5 },
        { text: `${periodeLabel} Lalu`, head: true, align: "center", span: 3 },
        { text: `${periodeLabel} ini`, head: true, align: "center", span: 3 },
        { text: `S/d ${periodeLabel} ini`, head: true, align: "center", span: 3 },
        { text: "", head: true },
        { text: `S/d ${periodeLabel} ini`, head: true, align: "center", span: 2 },
      ],
      rinci,
    );
    y = gridRow(
      doc,
      y,
      [
        { text: "", head: true, span: 5 },
        ...([0, 1, 2].flatMap((): GridCell[] => [
          { text: "Volume", head: true, align: "center" },
          { text: "Prestasi", head: true, align: "center" },
          { text: "Bobot", head: true, align: "center" },
        ])),
        { text: "", head: true },
        { text: "Prestasi", head: true, align: "center" },
        { text: "Volume", head: true, align: "center" },
      ],
      rinci,
    );
  };
  rinciHead();

  for (const c of r.categories) {
    const catCells: GridCell[] = [
      { text: c.code, align: "center", bold: true },
      { text: c.name, span: 3, bold: true },
      { text: p2(c.subtotalBobot), align: "right", bold: true },
      { text: "", span: 12 },
    ];
    fit(gridRowHeight(doc, catCells, rinci), rinciHead);
    y = gridRow(doc, y, catCells, rinci);

    for (const it of c.rows) {
      const cells: GridCell[] = [
        { text: String(it.no), align: "right" },
        { text: it.name },
        { text: volFmt.format(it.volK), align: "right" },
        { text: it.unit, align: "center" },
        { text: p2(it.bobot), align: "right" },
        { text: dash(it.volLalu), align: "right" },
        { text: it.prestasiLalu > 0 ? p1(it.prestasiLalu) : "–", align: "right" },
        { text: it.bobotLalu > 0 ? p2(it.bobotLalu) : "–", align: "right" },
        { text: dash(it.volIni), align: "right" },
        { text: it.prestasiIni > 0 ? p1(it.prestasiIni) : "–", align: "right" },
        { text: it.bobotIni > 0 ? p2(it.bobotIni) : "–", align: "right" },
        { text: dash(it.volSd), align: "right" },
        { text: it.prestasiSd > 0 ? p1(it.prestasiSd) : "–", align: "right" },
        { text: it.bobotSd > 0 ? p2(it.bobotSd) : "–", align: "right" },
        { text: it.bobotRencana > 0 ? p2(it.bobotRencana) : "–", align: "right" },
        { text: it.sisaPrestasi > 0 ? p1(it.sisaPrestasi) : "–", align: "right" },
        { text: dash(it.sisaVol), align: "right" },
      ];
      fit(gridRowHeight(doc, cells, rinci), rinciHead);
      y = gridRow(doc, y, cells, rinci);
    }
  }

  const jumlah: GridCell[] = [
    { text: "J U M L A H", span: 4, align: "right", bold: true },
    { text: p2(r.categories.reduce((s, c) => s + c.subtotalBobot, 0)), align: "right", bold: true },
    { text: p2(r.totals.bobotLalu), span: 3, align: "right", bold: true },
    { text: p2(r.totals.bobotIni), span: 3, align: "right", bold: true },
    { text: p2(r.totals.bobotSd), span: 3, align: "right", bold: true },
    { text: p2(r.totals.bobotRencana), align: "right", bold: true },
    { text: "", span: 2 },
  ];
  fit(gridRowHeight(doc, jumlah, rinci), rinciHead);
  y = gridRow(doc, y, jumlah, rinci);
  y += 4;

  // Ringkasan bobot (cermin blok ringkas di bawah tabel pada komponen layar).
  const ringkasOpt: GridOptions = { x, width: width * 0.5, cols: colWidths(width * 0.5, [2, 1]), fontSize: 7.5 };
  fit(4 * 12); // empat baris ringkasan jangan terbelah dua halaman
  for (const [k, v] of [
    [`Bobot Realisasi ${periodeLabel} Ini`, `${p2(r.totals.bobotIni)}%`],
    ["Bobot Realisasi s/d Periode", `${p2(r.totals.bobotSd)}%`],
    ["Bobot Rencana s/d Periode", `${p2(r.planPct)}%`],
    ["Deviasi (+/-)", `${r.deviationPct >= 0 ? "+" : ""}${p2(r.deviationPct)}%`],
  ] as [string, string][]) {
    draw([{ text: k, head: true }, { text: v, align: "right" }], ringkasOpt);
  }
  y += 6;

  sectionTitle(doc, "2. Tenaga Kerja, Material & Peralatan (Agregat Periode)", x, () => y, (v) => (y = v));
  const third = width / 3;
  const resOpt = (idx: number): GridOptions => ({
    x: x + idx * third,
    width: third,
    cols: colWidths(third, [2.4, 1]),
    fontSize: 7,
  });
  const resTables: [string, [string, string], [string, string][]][] = [
    ["Tenaga Kerja", ["Peran", "Orang-hari"], r.tenaga.map((t) => [t.label, String(t.count)])],
    [
      "Material Masuk",
      ["Material", "Jumlah"],
      r.material.map((m) => [m.name, `${volFmt.format(m.qty)}${m.unit ? ` ${m.unit}` : ""}`]),
    ],
    ["Peralatan", ["Alat", "Unit-hari"], r.alat.map((a) => [a.name, String(a.count)])],
  ];
  const resRows = resTables.map(([title, head, rows]) => [
    [{ text: title, head: true, span: 2, align: "center" }] as GridCell[],
    [
      { text: head[0], head: true },
      { text: head[1], head: true, align: "center" },
    ] as GridCell[],
    ...(rows.length > 0
      ? rows.map(([a, b]): GridCell[] => [{ text: a }, { text: b, align: "right" }])
      : [[{ text: "–", span: 2, align: "center" }] as GridCell[]]),
  ]);
  const maxRes = Math.max(...resRows.map((t) => t.length));
  for (let i = 0; i < maxRes; i++) {
    const heights = resRows.map((t, idx) => (t[i] ? gridRowHeight(doc, t[i], resOpt(idx)) : 0));
    const rowH = Math.max(...heights, 0);
    if (rowH === 0) continue;
    fit(rowH);
    for (const [idx, t] of resRows.entries()) {
      if (!t[i]) continue;
      gridRow(doc, y, t[i], { ...resOpt(idx), minRowHeight: rowH });
    }
    y += rowH;
  }
  y += 4;
  doc
    .font(PDF_FONT.regular)
    .fontSize(7.5)
    .fillColor(PDF_COLORS.ink)
    .text(`Ringkasan cuaca periode: ${r.cuacaRingkas || "–"}`, x, y, { width });
  y += 14;

  sectionTitle(doc, "3. Kendala Lapangan", x, () => y, (v) => (y = v));
  const kendalaOpt: GridOptions = { x, width, cols: colWidths(width, [1.4, 5, 1, 1.2]), fontSize: 7 };
  draw(
    [
      { text: "Tanggal", head: true, align: "center" },
      { text: "Kendala", head: true },
      { text: "Tingkat", head: true, align: "center" },
      { text: "Status", head: true, align: "center" },
    ],
    kendalaOpt,
  );
  if (r.kendala.length === 0) {
    draw([{ text: "Tidak ada kendala tercatat pada periode ini.", span: 4, align: "center" }], kendalaOpt);
  } else {
    for (const k of r.kendala) {
      draw(
        [
          { text: formatTanggal(k.createdAt), align: "center" },
          { text: k.title },
          { text: k.severity, align: "center" },
          { text: k.status.replace(/_/g, " "), align: "center" },
        ],
        kendalaOpt,
      );
    }
  }

  y += 10;
  signatureBlock(doc, { x, width, getY: () => y, h, fit: (need) => fit(need), setY: (v) => (y = v), gambarTtd, jenis: r.kind });

  catatanKaki(doc, appName, width);
  return docToBuffer(doc);
}

/** Catatan kaki tiap halaman: nama aplikasi + "Halaman i dari n". */
function catatanKaki(doc: PdfDoc, appName: string, width: number): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .font(PDF_FONT.regular)
      .fontSize(6.5)
      .fillColor(PDF_COLORS.inkFaint)
      .text(appName, LANDSCAPE_MARGIN, doc.page.height - LANDSCAPE_MARGIN + 2, {
        width,
        align: "left",
        lineBreak: false,
      })
      .text(`Halaman ${i - range.start + 1} dari ${range.count}`, LANDSCAPE_MARGIN, doc.page.height - LANDSCAPE_MARGIN + 2, {
        width,
        align: "right",
        lineBreak: false,
      });
  }
}

/** Judul bagian bergaris bawah — cermin `SectionTitle` komponen layar. */
function sectionTitle(doc: PdfDoc, text: string, x: number, getY: () => number, setY: (v: number) => void): void {
  const y = getY();
  doc.font(PDF_FONT.bold).fontSize(8.5).fillColor(PDF_COLORS.ink).text(text, x, y, { lineBreak: false });
  setY(y + 12);
}

/** Blok tanda tangan 3 kolom (PPK · Konsultan Pengawas · Penyedia Jasa). */
function signatureBlock(
  doc: PdfDoc,
  o: {
    x: number;
    width: number;
    /**
     * Posisi saat ini – DIBACA SESUDAH `fit`. Dulu `y` dikirim sebagai angka:
     * bila `fit` membuka halaman baru, blok tetap digambar di dasar halaman
     * lama, meluber, dan pdfkit menambah halaman berisi sepotong tanda tangan
     * (laporan user 2026-10-12, "halaman 19 ke atas berantakan").
     */
    getY: () => number;
    h: PeriodReport["header"];
    fit: (need: number) => void;
    setY: (v: number) => void;
    gambarTtd?: TtdPdf | null;
    /** Menentukan siapa yang mengisi slot penyedia (DECISIONS 402). */
    jenis: JenisDokumen;
  },
): void {
  const opt: GridOptions = {
    x: o.x,
    width: o.width,
    cols: colWidths(o.width, [1, 1, 1]),
    fontSize: 7.5,
    minRowHeight: 90,
  };
  const nameOf = (n: string | null, sub: string | null) =>
    `\n\n\n\n\n( ${n ?? "……………………………"} )${sub ? `\n${sub}` : ""}`;
  // Siapa meneken – SATU tempat untuk cetak, PDF, Excel (DECISIONS 662).
  const tt = penandatanganDokumen(o.jenis, o.h);
  const sel: GridCell[] = [
    {
      text: `MENGETAHUI :\n${peranSlot(tt.kkp, true)}${nameOf(tt.kkp.nama, tt.kkp.sub)}`,
      align: "center",
    },
    {
      text: `DIPERIKSA :\n${peranSlot(tt.konsultan, true)}${nameOf(tt.konsultan.nama, tt.konsultan.sub)}`,
      align: "center",
    },
    {
      text: `DIBUAT OLEH :\n${peranSlot(tt.penyedia, true)}${nameOf(tt.penyedia.nama, tt.penyedia.sub)}`,
      align: "center",
    },
  ];
  // Tinggi DIUKUR (peran/firma bisa terbungkus dua baris), lalu posisi dibaca
  // ulang: `fit` mungkin baru saja membuka halaman.
  o.fit(gridRowHeight(doc, sel, opt));
  const yAtas = o.getY();
  /* Gambar tanda tangan & stempel digambar LEBIH DULU, teksnya menyusul di
     atasnya (DECISIONS 412) — PDF tidak punya z-index, jadi urutan menggambar
     itulah lapisannya. Urutan kolomnya tetap: PPK · pengawas · penyedia — sama
     dengan teks. Baris nama "( … )" ada di baris ke-5 blok; coretan berpijak
     tepat di atasnya. */
  const lebarKolomTtd = o.width / 3;
  // Ruang dari tepi ATAS blok sampai garis nama. Stempel dibatasi tepat
  // sebesar ini supaya tidak menembus tabel di atasnya (DECISIONS 333).
  const RUANG_TTD = 68;
  const URUT_TTD = ["ppk", "pengawas", "penyedia"] as const;
  const y = blokTandaTanganPdf(
    doc,
    o.gambarTtd
      ? URUT_TTD.map((pihak, i) => ({
          berkas: o.gambarTtd![pihak],
          opsi: {
            xTengah: o.x + i * lebarKolomTtd + lebarKolomTtd / 2,
            yDasar: yAtas + RUANG_TTD,
            lebarKolom: lebarKolomTtd,
            ruangDiAtasNama: RUANG_TTD,
          },
        }))
      : [],
    () => gridRow(doc, yAtas, sel, opt),
  );

  o.setY(y);
}

/** Batang skala 0–100% kotak-kotak (hitam-putih) + label, di kolom KETERANGAN. */
function drawKetScale(
  doc: PdfDoc,
  o: { left: number; colWidth: number; top: number; height: number },
): void {
  if (o.height <= 0 || o.colWidth <= 6) return;
  const barW = Math.min(10, o.colWidth * 0.42);
  const bx = o.left + 2;
  const bandH = o.height / 10;
  doc.save();
  for (let band = 0; band < 10; band++) {
    const by = o.top + band * bandH;
    doc.rect(bx, by, barW / 2, bandH).fill(band % 2 === 0 ? "#000000" : "#ffffff");
    doc.rect(bx + barW / 2, by, barW / 2, bandH).fill(band % 2 === 0 ? "#ffffff" : "#000000");
  }
  doc.rect(bx, o.top, barW, o.height).lineWidth(0.4).strokeColor("#000000").stroke();
  doc.font(PDF_FONT.bold).fontSize(4.8).fillColor(PDF_COLORS.ink);
  for (const g of [100, 75, 50, 25, 0]) {
    const gy = o.top + (1 - g / 100) * o.height - 2;
    doc.text(String(g), bx + barW + 1.5, gy, { width: o.colWidth - barW - 3, align: "left", lineBreak: false });
  }
  doc.restore();
}

/**
 * Garis kurva-S di atas blok baris kategori: rencana (biru) & realisasi (hijau),
 * keduanya mulai dari 0% di kiri-bawah seperti pada layar. Realisasi berhenti di
 * minggu ber-realisasi terakhir.
 */
function drawCurveOverlay(
  doc: PdfDoc,
  o: {
    left: number;
    top: number;
    plotWidth: number;
    plotHeight: number;
    plan: number[];
    actual: (number | null)[];
  },
): void {
  if (o.plotHeight <= 0 || o.plotWidth <= 0 || o.plan.length === 0) return;
  const n = o.plan.length;
  const px = (w: number) => o.left + (w / n) * o.plotWidth;
  const py = (p: number) => o.top + (1 - Math.min(100, Math.max(0, p)) / 100) * o.plotHeight;

  doc.save();
  // Garis bantu 0/25/50/75/100%.
  doc.lineWidth(0.3).strokeColor("#cbd5e1");
  for (const g of [0, 25, 50, 75, 100]) {
    doc.moveTo(o.left, py(g)).lineTo(o.left + o.plotWidth, py(g)).stroke();
  }
  const line = (pts: [number, number][], color: string, w: number) => {
    if (pts.length < 2) return;
    doc.lineWidth(w).strokeColor(color);
    doc.moveTo(pts[0][0], pts[0][1]);
    for (const [cx, cy] of pts.slice(1)) doc.lineTo(cx, cy);
    doc.stroke();
    doc.fillColor(color);
    for (const [cx, cy] of pts.slice(1)) doc.circle(cx, cy, 1.1).fill();
  };
  line([[px(0), py(0)], ...o.plan.map((p, i): [number, number] => [px(i + 1), py(p)])], "#2563eb", 1.1);
  const act: [number, number][] = [[px(0), py(0)]];
  for (const [i, v] of o.actual.entries()) {
    if (v == null) break;
    act.push([px(i + 1), py(v)]);
  }
  line(act, "#16a34a", 1.2);
  doc.restore();
}

/**
 * LAPORAN RENCANA & REALISASI MINGGUAN PER KATEGORI (DECISIONS 674) – cermin
 * halaman `/cetak/rencana-realisasi`. Isi dari `susunRencanaRealisasi`; di sini
 * hanya ditata. Dua baris per kategori (Rencana, Realisasi) tidak dipisah halaman.
 */
export async function buildRencanaRealisasiPdf(
  r: PeriodReport,
  appName: string,
  gambarTtd?: TtdPdf | null,
): Promise<Buffer> {
  const lap = susunRencanaRealisasi(r);
  const h = r.header;
  const doc = createLandscapeA4Doc({ title: `Rencana & Realisasi per Kategori – ${h.locationName}` });
  const x = LANDSCAPE_MARGIN;
  const width = doc.page.width - LANDSCAPE_MARGIN * 2;
  const bottom = doc.page.height - LANDSCAPE_MARGIN - 14;
  let y = LANDSCAPE_MARGIN;
  const noAutoBreak = () => {
    doc.page.margins.bottom = 0;
  };
  noAutoBreak();
  const fit = (need: number, ulangKepala?: () => void) => {
    if (y + need <= bottom) return;
    doc.addPage();
    noAutoBreak();
    y = LANDSCAPE_MARGIN;
    ulangKepala?.();
  };
  const centerText = (text: string, size: number, bold: boolean, gap = 2) => {
    doc.font(bold ? PDF_FONT.bold : PDF_FONT.regular).fontSize(size).fillColor(PDF_COLORS.ink);
    doc.text(text, x, y, { width, align: "center", lineBreak: false });
    y += size + gap;
  };

  const rentangKini = lap.weekRanges[lap.sampai - 1];
  centerText(lap.judul, 12, true);
  centerText(
    `Posisi s/d Minggu ke-${lap.sampai}${rentangKini ? ` (${rentangKini})` : ""} · Periode kontrak ` +
      `${formatTanggal(h.contractStart)} s/d ${formatTanggal(h.contractEnd ?? h.periodeEnd)}`,
    8,
    true,
    6,
  );
  const identOpt: GridOptions = { x, width, cols: colWidths(width, [1.1, 2.6, 1.1, 2.2]), fontSize: 7.5 };
  for (const [k1, v1, k2, v2] of [
    ["Paket Pekerjaan", h.packageName, "Kontraktor Pelaksana", h.vendorName],
    [
      "Lokasi",
      `${h.village}${h.district ? `, Kec. ${h.district}` : ""}, ${h.regency}, ${h.province}`,
      "Masa Pelaksanaan",
      `${h.masaPelaksanaanHari} Hari Kalender`,
    ],
    ["Nilai Fisik Lokasi", rupiah(Number(h.locationValue)), "Tahun Anggaran", String(h.tahunAnggaran)],
    ["Nomor Kontrak", h.contractNumber || "–", "Minggu berjalan", `Minggu ke-${lap.sampai} dari ${lap.totalMinggu}`],
  ] as [string, string, string, string][]) {
    y = gridRow(doc, y, [{ text: k1, head: true }, { text: v1 }, { text: k2, head: true }, { text: v2 }], identOpt);
  }
  y += 3;
  doc.font(PDF_FONT.regular).fontSize(6.5).fillColor(PDF_COLORS.ink);
  doc.text(
    `Angka mingguan = bobot terhadap nilai fisik lokasi (%). Kolom "% Kategori" = capaian s/d minggu ke-${lap.sampai} ` +
      "terhadap kategori itu sendiri.",
    x,
    y,
    { width, oblique: true, lineBreak: false },
  );
  y += 10;

  const N = lap.totalMinggu;
  const fs = N > 26 ? 4.6 : N > 18 ? 5.2 : 6;
  const opt: GridOptions = {
    x,
    width,
    cols: colWidths(width, [0.9, 3.6, 1.0, 1.75, ...Array.from({ length: N }, () => 1), 1.3, 1.3]),
    fontSize: fs,
    padY: 1.5,
    minRowHeight: 9,
  };
  const kini = (w: number) => (w === lap.sampai ? "#fef3c7" : undefined);
  const kepala = () => {
    y = gridRow(
      doc,
      y,
      [
        { text: "No", head: true, align: "center" },
        { text: "Uraian Pekerjaan", head: true, align: "center" },
        { text: "Bobot (%)", head: true, align: "center" },
        { text: "Keterangan", head: true, align: "center" },
        ...lap.monthGroups.map((g): GridCell => ({ text: g.label, head: true, align: "center", span: g.span })),
        { text: `s/d M${lap.sampai}`, head: true, align: "center" },
        { text: "% Kategori", head: true, align: "center" },
      ],
      opt,
    );
    y = gridRow(
      doc,
      y,
      [
        { text: "", head: true, span: 4 },
        ...Array.from({ length: N }, (_, i): GridCell => ({
          text: `M${i + 1}\n${lap.weekRanges[i] ?? ""}`,
          head: true,
          align: "center",
          bg: kini(i + 1),
        })),
        { text: "", head: true },
        { text: "", head: true },
      ],
      opt,
    );
  };
  kepala();

  const a3 = (v: number) => f3.format(v);
  const rencanaSel = (v: number) => (Math.abs(v) < 0.0005 ? "" : a3(v));
  const realisasiSel = (v: number | null) => (v == null ? "" : Math.abs(v) < 0.0005 ? "–" : a3(v));
  const minggu = (isi: string[], bold = false): GridCell[] =>
    isi.map((text, w) => ({ text, align: "right", bold, bg: kini(w + 1) }));

  for (const b of lap.baris) {
    const telat = b.ringkas.realisasiSd + 0.0005 < b.ringkas.rencanaSd;
    const baris1: GridCell[] = [
      { text: b.code, align: "center" },
      { text: b.name, bold: true },
      { text: f2.format(b.bobot), align: "center" },
      { text: "Rencana", color: "#1d4ed8" },
      ...minggu(b.rencana.map(rencanaSel)),
      { text: a3(b.ringkas.rencanaSd), align: "right" },
      { text: `${f2.format(b.ringkas.rencanaPct)}%`, align: "right" },
    ];
    const baris2: GridCell[] = [
      { text: "" },
      { text: "" },
      { text: "" },
      { text: "Realisasi", color: "#15803d" },
      ...minggu(b.realisasi.map(realisasiSel)),
      { text: a3(b.ringkas.realisasiSd), align: "right", bold: true },
      { text: `${f2.format(b.ringkas.realisasiPct)}%`, align: "right", bold: true, color: telat ? "#b91c1c" : undefined },
    ];
    fit(gridRowHeight(doc, baris1, opt) + gridRowHeight(doc, baris2, opt), kepala);
    y = gridRow(doc, y, baris1, opt);
    y = gridRow(doc, y, baris2, opt);
  }

  const t = lap.total;
  const s = lap.sampai - 1;
  for (const [label, isi, sd] of [
    ["Rencana mingguan (%)", t.rencana.map(rencanaSel), a3(t.ringkas.rencanaSd)],
    ["Realisasi mingguan (%)", t.realisasi.map(realisasiSel), a3(t.ringkas.realisasiSd)],
    ["Kumulatif rencana (%)", t.kumRencana.map((v) => f2.format(v)), f2.format(t.kumRencana[s] ?? 0)],
    ["Kumulatif realisasi (%)", t.kumRealisasi.map((v) => (v == null ? "" : f2.format(v))), f2.format(t.kumRealisasi[s] ?? 0)],
    ["Deviasi (%)", t.deviasi.map((v) => (v == null ? "" : f2.format(v))), f2.format(t.deviasi[s] ?? 0)],
  ] as [string, string[], string][]) {
    const sel: GridCell[] = [
      { text: label, span: 4, align: "right", bold: true, bg: PDF_COLORS.primary50 },
      ...minggu(isi, true),
      { text: sd, align: "right", bold: true },
      { text: "" },
    ];
    fit(gridRowHeight(doc, sel, opt), kepala);
    y = gridRow(doc, y, sel, opt);
  }
  y += 8;
  signatureBlock(doc, { x, width, getY: () => y, h, fit: (need) => fit(need), setY: (v) => (y = v), gambarTtd, jenis: "mingguan" });
  catatanKaki(doc, appName, width);
  return docToBuffer(doc);
}

/** Muat data + render PDF Rencana & Realisasi per Kategori. TANPA otorisasi (pemanggil gate). */
export async function renderRencanaRealisasiPdf(locationId: string): Promise<PeriodikKkpPdfResult | null> {
  const bounds = await getPeriodBounds(locationId, { assume: true });
  if (!bounds) return null;
  const [report, branding] = await Promise.all([
    getPeriodReport(locationId, "mingguan", bounds.currentWeek, { assume: true }),
    getBranding(),
  ]);
  if (!report) return null;
  const gambarTtd = await muatTtdPdf(locationId, "mingguan").catch(() => TANPA_TTD_PDF);
  return { buffer: await buildRencanaRealisasiPdf(report, branding.appName, gambarTtd) };
}

/** Muat laporan periodik + render PDF blanko KKP. TANPA otorisasi (pemanggil gate). */
export async function renderPeriodikKkpPdf(
  locationId: string,
  kind: PeriodKind,
  n: number,
): Promise<PeriodikKkpPdfResult | null> {
  const [report, branding] = await Promise.all([getPeriodReport(locationId, kind, n), getBranding()]);
  if (!report) return null;
  // Best-effort, sama dengan logo: kegagalannya menghasilkan ruang kosong,
  // bukan PDF yang gagal terbit.
  const [gambarTtd, logo] = await Promise.all([
    muatTtdPdf(locationId, kind).catch(() => TANPA_TTD_PDF),
    kind === "mingguan" ? muatLogoLaporan(locationId) : Promise.resolve(null),
  ]);
  return { buffer: await buildPeriodikKkpPdf(report, branding.appName, gambarTtd, logo) };
}

/**
 * Muat Time Schedule + render PDF – data diambil PERSIS seperti halaman
 * `/cetak/jadwal`: snapshot s/d minggu berjalan, periode = seluruh masa
 * kontrak, dan sebelum SPMK tanggal mulainya diasumsikan (dan disebut).
 * TANPA otorisasi (pemanggil gate). Null bila kontrak/durasi belum ada.
 */
/**
 * Render Kurva-S paket dari hasil `susunKurvaPaket` – periode, catatan, dan
 * penanda tangan dokumen jadwal lokasi acuan (kontrak yang sama). TANPA
 * otorisasi (pemanggil gate).
 */
export async function renderKurvaPaketPdf(dok: KurvaPaketDokumen): Promise<PeriodikKkpPdfResult> {
  const branding = await getBranding();
  const gambarTtd = await muatTtdPdf(dok.lokasiAcuanId, "jadwal").catch(() => TANPA_TTD_PDF);
  return {
    buffer: await buildKurvaPaketPdf(dok.report, branding.appName, gambarTtd, {
      periode: { start: dok.bounds.startDate, end: dok.bounds.endDate },
      catatan: dok.catatan ? `Catatan: ${dok.catatan}` : null,
    }),
  };
}

export async function renderJadwalKkpPdf(locationId: string): Promise<PeriodikKkpPdfResult | null> {
  const bounds = await getPeriodBounds(locationId, { assume: true });
  if (!bounds) return null;
  const [report, branding] = await Promise.all([
    getPeriodReport(locationId, "mingguan", bounds.currentWeek, { assume: true }),
    getBranding(),
  ]);
  if (!report) return null;
  const gambarTtd = await muatTtdPdf(locationId, "jadwal").catch(() => TANPA_TTD_PDF);
  // Kalimat yang sama dengan catatan di halaman cetak – jadwal berasumsi tidak
  // boleh beredar tanpa mengatakannya.
  const catatan = bounds.assumed
    ? `Catatan: SPMK belum diterbitkan. Jadwal ini dihitung dari asumsi mulai ${formatTanggal(bounds.startDate)} ` +
      `(durasi kontrak ${report.header.masaPelaksanaanHari} hari). Tanggalnya akan menyesuaikan sendiri setelah ` +
      `tanggal SPMK diisi.`
    : null;
  return {
    buffer: await buildJadwalKkpPdf(report, branding.appName, gambarTtd, {
      periode: { start: bounds.startDate, end: bounds.endDate },
      catatan,
    }),
  };
}
