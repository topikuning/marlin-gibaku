import "server-only";
import { penyediaLaporan, type JenisDokumen } from "@/lib/laporan/penandatangan";
import { getBranding } from "@/lib/branding";
import { getPeriodReport, type PeriodKind, type PeriodReport } from "@/lib/periodic-report";
import { buildKurvaSheet } from "@/lib/scurve/kkp-sheet";
import { formatTanggal } from "@/lib/format";
import { PDF_COLORS, PDF_FONT, docToBuffer, createLandscapeA4Doc, LANDSCAPE_MARGIN, type PdfDoc } from "./document";
import { colWidths, gridRow, gridRowHeight, type GridCell, type GridOptions } from "./grid";
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
): Promise<Buffer> {
  const kindLabel = r.kind === "mingguan" ? "MINGGU" : "BULAN";
  const periodeLabel = r.kind === "mingguan" ? "Minggu" : "Bulan";
  const doc = createLandscapeA4Doc({ title: `Laporan ${periodeLabel} ke-${r.n} – ${r.header.locationName}` });
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
  centerText(`KURVA S ${kindLabel} KE - ${r.n}`, 12, true);
  centerText(
    `Periode tanggal ${formatTanggal(h.periodeStart)} s/d ${formatTanggal(h.periodeEnd)}`,
    8,
    true,
    6,
  );

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
      { text: "Nilai Fisik Lokasi", head: true },
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
  const kurvaOpt: GridOptions = { x, width, cols: kurvaCols, fontSize: kurvaFont };

  // Header 2 baris: kelompok bulan (span) + M1..MN.
  const monthCells: GridCell[] = [
    { text: "No", head: true, align: "center" },
    { text: "Uraian Pekerjaan", head: true, align: "center" },
    { text: "Bobot (%)", head: true, align: "center" },
    ...sheet.monthGroups.map((g): GridCell => ({ text: g.label, head: true, align: "center", span: g.span })),
    { text: "KET", head: true, align: "center" },
  ];
  const weekCells: GridCell[] = [
    { text: "", head: true },
    { text: "", head: true },
    { text: "", head: true },
    ...Array.from({ length: N }, (_, i): GridCell => ({ text: `M${i + 1}`, head: true, align: "center" })),
    { text: "", head: true },
  ];
  const kurvaHead = () => {
    y = gridRow(doc, y, monthCells, kurvaOpt);
    y = gridRow(doc, y, weekCells, kurvaOpt);
  };
  kurvaHead();

  // Baris kategori — sekaligus catat rentang vertikal untuk overlay kurva.
  const plotTop = y;
  for (const c of sheet.categories) {
    const cells: GridCell[] = [
      { text: c.code, align: "center" },
      { text: c.name, bold: true },
      { text: p2(c.bobotShown), align: "center" },
      ...c.weeklyShown.map((v): GridCell => ({ text: v > 0 ? f3.format(v) : "", align: "right" })),
      { text: "", align: "center" },
    ];
    fit(gridRowHeight(doc, cells, kurvaOpt), kurvaHead);
    y = gridRow(doc, y, cells, kurvaOpt);
  }
  const plotBottom = y;

  // Baris prestasi (rencana/realisasi kumulatif + deviasi).
  const prestasiRows: [string, (number | null)[], boolean][] = [
    ["Rencana Prestasi %", sheet.rencanaPerWeek, false],
    ["Kumulatif Rencana Prestasi %", sheet.kumulatifRencana, true],
    ["Realisasi Prestasi %", sheet.realisasiPerWeek, false],
    ["Kumulatif Realisasi Prestasi %", sheet.kumulatifRealisasi, true],
    ["Deviasi +/-", sheet.deviasi, true],
  ];
  for (const [label, arr, bold] of prestasiRows) {
    const cells: GridCell[] = [
      { text: label, span: 2, align: "right", bold },
      { text: label.startsWith("Kumulatif Rencana") ? p2(sheet.totalBobotShown) : "", align: "center", bold },
      // Tanpa akhiran "%" — label barisnya sudah menyebut %, dan sufiks itu
      // membuat "100,00%" terbungkus dua baris di kolom minggu yang sempit.
      ...arr.map((v): GridCell => ({ text: v == null ? "" : f2.format(v), align: "right", bold })),
      { text: "", align: "center" },
    ];
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
  signatureBlock(doc, { x, width, y, h, fit: (need) => fit(need), setY: (v) => (y = v), gambarTtd, jenis: r.kind });

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
  signatureBlock(doc, { x, width, y, h, fit: (need) => fit(need), setY: (v) => (y = v), gambarTtd, jenis: r.kind });

  /* ── Catatan kaki tiap halaman ──────────────────────────────────────── */
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

  return docToBuffer(doc);
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
    y: number;
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
  const penyedia = penyediaLaporan(o.jenis, o.h);
  o.fit(90);
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
            yDasar: o.y + RUANG_TTD,
            lebarKolom: lebarKolomTtd,
            ruangDiAtasNama: RUANG_TTD,
          },
        }))
      : [],
    () =>
      gridRow(
        doc,
        o.y,
        [
          {
            text: `MENGETAHUI :\nPEJABAT PEMBUAT KOMITMEN${nameOf(o.h.ppkName, o.h.ppkNip ? `NIP. ${o.h.ppkNip}` : null)}`,
            align: "center",
          },
          {
            text: `DIPERIKSA :\nKONSULTAN PENGAWAS${nameOf(o.h.supervisorName, o.h.supervisorFirm)}`,
            align: "center",
          },
          {
            text: `DIBUAT OLEH :\nPENYEDIA JASA – ${o.h.vendorName}${nameOf(penyedia.nama, penyedia.sub)}`,
            align: "center",
          },
        ],
        opt,
      ),
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
  const gambarTtd = await muatTtdPdf(locationId, kind).catch(() => TANPA_TTD_PDF);
  return { buffer: await buildPeriodikKkpPdf(report, branding.appName, gambarTtd) };
}
