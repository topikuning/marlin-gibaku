import "server-only";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { getKkpDailyData } from "@/lib/daily-report/queries";
import { WORKER_ROLE_LABEL, WORKER_ROLE_ORDER } from "@/lib/daily-report/constants";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { PDF_COLORS, PDF_FONT, docToBuffer, createLandscapeA4Doc, LANDSCAPE_MARGIN } from "./document";
import { colWidths, gridRow, gridRowHeight, type GridCell, type GridOptions } from "./grid";

/**
 * Laporan Harian format KKP — BLANKO RESMI (bukan ringkasan naratif): kop tiga
 * kolom, identitas proyek, progres per item dengan volume kontrak & s/d lalu,
 * tenaga kerja + material/peralatan, matriks cuaca per jam, catatan, dan blok
 * tanda tangan Konsultan Pengawas / Kontraktor Pelaksana.
 *
 * Tata letak mengikuti komponen web `KkpDailyReport` supaya yang dicetak dari
 * layar dan yang disetor ke Drive IDENTIK. A4 lanskap karena matriks cuaca
 * butuh 16 kolom. DECISIONS 145.
 */

const HOURS = ["07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21"];
const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const pctFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

export type HarianKkpPdfResult = { buffer: Buffer; locationId: string };

export async function buildHarianKkpPdf(d: KkpDailyData, appName: string): Promise<Buffer> {
  const doc = createLandscapeA4Doc({ title: `Laporan Harian KKP — ${d.locationName}` });
  const x = LANDSCAPE_MARGIN;
  const width = doc.page.width - LANDSCAPE_MARGIN * 2;
  const bottom = doc.page.height - LANDSCAPE_MARGIN - 14;
  let y = LANDSCAPE_MARGIN;

  // Matikan paginasi otomatis pdfkit: penempatan baris diatur manual lewat `fit`.
  // Tanpa ini, doc.text() dekat margin bawah memicu halaman baru yang kosong.
  const noAutoBreak = () => {
    doc.page.margins.bottom = 0;
  };
  noAutoBreak();

  /** Pindah halaman bila baris berikutnya tak muat; ulangi header tabel bila ada. */
  const fit = (need: number, repeatHeader?: () => void) => {
    if (y + need <= bottom) return;
    doc.addPage();
    noAutoBreak();
    y = LANDSCAPE_MARGIN;
    repeatHeader?.();
  };

  const draw = (cells: GridCell[], o: GridOptions) => {
    fit(gridRowHeight(doc, cells, o));
    y = gridRow(doc, y, cells, o);
  };

  /* ── Kop ───────────────────────────────────────────────────────────── */
  const kop: GridOptions = { x, width, cols: colWidths(width, [2, 1, 1]), fontSize: 8, minRowHeight: 34 };
  y = gridRow(
    doc,
    y,
    [
      // Identitas pemilik pekerjaan dari menu Sistem — bukan hardcode KKP
      // (DECISIONS 166), supaya satu basis kode melayani klien mana pun.
      {
        text: `LAPORAN HARIAN\n${[d.ownerSubtitle, d.ownerName].filter(Boolean).join(" · ")}`,
        bold: true,
      },
      { text: "KONSULTAN PENGAWAS", align: "center", head: true },
      { text: "KONTRAKTOR PELAKSANA", align: "center", head: true },
    ],
    kop,
  );

  /* ── Identitas proyek ──────────────────────────────────────────────── */
  const ident: GridOptions = { x, width, cols: colWidths(width, [1, 2.4, 1, 3.6]), fontSize: 8 };
  draw(
    [
      { text: "Minggu Ke", head: true },
      { text: d.weekNo != null ? String(d.weekNo) : "…" },
      { text: "Pekerjaan", head: true },
      { text: "Konstruksi KNMP" },
    ],
    ident,
  );
  draw(
    [
      { text: "Hari", head: true },
      { text: d.hari },
      { text: "Lokasi", head: true },
      { text: `${d.locationName}, ${d.regency}, ${d.province}` },
    ],
    ident,
  );
  draw(
    [
      { text: "Tanggal", head: true },
      { text: d.tanggalFull },
      { text: "Th. Anggaran", head: true },
      { text: String(d.tahunAnggaran) },
    ],
    ident,
  );

  /* ── Progres per kegiatan ──────────────────────────────────────────── */
  const prog: GridOptions = { x, width, cols: colWidths(width, [0.5, 6, 0.8, 1.2, 1.2, 1.2, 1.2, 0.8]), fontSize: 7.5 };
  const progHead = () => {
    y = gridRow(
      doc,
      y,
      [
        { text: "No", head: true, align: "center" },
        { text: "Uraian Pekerjaan (Progres Hari Ini)", head: true },
        { text: "Sat", head: true, align: "center" },
        { text: "Vol Kontrak", head: true, align: "center" },
        { text: "s/d Lalu", head: true, align: "center" },
        { text: "Hari Ini", head: true, align: "center" },
        { text: "s/d", head: true, align: "center" },
        { text: "%", head: true, align: "center" },
      ],
      prog,
    );
  };
  progHead();
  if (d.items.length === 0) {
    draw([{ text: "Tidak ada realisasi tercatat pada tanggal ini.", span: 8, align: "center" }], prog);
  } else {
    d.items.forEach((it, i) => {
      const cells: GridCell[] = [
        { text: String(i + 1), align: "center" },
        { text: it.name },
        { text: it.unit ?? "", align: "center" },
        { text: it.volumeContract != null ? volFmt.format(it.volumeContract) : "", align: "right" },
        { text: volFmt.format(it.volumeBefore), align: "right" },
        { text: volFmt.format(it.volumeToday), align: "right" },
        { text: volFmt.format(it.volumeCumulative), align: "right" },
        { text: it.pctCumulative != null ? pctFmt.format(it.pctCumulative) : "", align: "right" },
      ];
      fit(gridRowHeight(doc, cells, prog), progHead);
      y = gridRow(doc, y, cells, prog);
    });
  }

  /* ── Tenaga kerja | Material & peralatan (berdampingan) ────────────── */
  const half = width / 2;
  const leftOpt: GridOptions = { x, width: half, cols: colWidths(half, [0.6, 4, 1]), fontSize: 7.5 };
  const rightOpt: GridOptions = {
    x: x + half,
    width: half,
    cols: colWidths(half, [0.6, 3.4, 0.8, 1.2]),
    fontSize: 7.5,
  };

  // Bangun daftar baris kedua sisi lebih dulu supaya bisa digambar sejajar.
  const leftRows: GridCell[][] = [
    [
      { text: "No", head: true, align: "center" },
      { text: "Tenaga Kerja (Keahlian)", head: true },
      { text: "Jmh", head: true, align: "center" },
    ],
    ...WORKER_ROLE_ORDER.map((r, i): GridCell[] => [
      { text: String(i + 1), align: "center" },
      { text: WORKER_ROLE_LABEL[r] },
      { text: String(d.workerMap[r] ?? 0), align: "center" },
    ]),
    [
      { text: "Jumlah", span: 2, align: "right", bold: true },
      { text: String(d.totalWorkers), align: "center", bold: true },
    ],
  ];

  const matRows: GridCell[][] = [
    [
      { text: "No", head: true, align: "center" },
      { text: "Rekap Pemasukan Bahan / Material", head: true },
      { text: "Sat", head: true, align: "center" },
      { text: "Diterima", head: true, align: "center" },
    ],
    ...d.materials.map((m, i): GridCell[] => [
      { text: String(i + 1), align: "center" },
      { text: m.name },
      { text: m.unit ?? "", align: "center" },
      { text: m.qty != null ? volFmt.format(m.qty) : "", align: "center" },
    ]),
    ...Array.from({ length: Math.max(0, 4 - d.materials.length) }, (_, i): GridCell[] => [
      { text: String(d.materials.length + i + 1), align: "center" },
      { text: " " },
      { text: " " },
      { text: " " },
    ]),
    [
      { text: "No", head: true, align: "center" },
      { text: "Peralatan", head: true, span: 3 },
    ],
    ...d.equipment.map((e, i): GridCell[] => [
      { text: String(i + 1), align: "center" },
      { text: e.count > 1 ? `${e.name} (${e.count})` : e.name, span: 3 },
    ]),
    ...Array.from({ length: Math.max(0, 3 - d.equipment.length) }, (_, i): GridCell[] => [
      { text: String(d.equipment.length + i + 1), align: "center" },
      { text: " ", span: 3 },
    ]),
  ];

  // Dua kolom digambar sejajar dari y yang SAMA; y akhir = sisi terpanjang.
  fit(60);
  const sideTop = y;
  let ly = sideTop;
  for (const row of leftRows) {
    if (ly + gridRowHeight(doc, row, leftOpt) > bottom) break;
    ly = gridRow(doc, ly, row, leftOpt);
  }
  let ry = sideTop;
  for (const row of matRows) {
    if (ry + gridRowHeight(doc, row, rightOpt) > bottom) break;
    ry = gridRow(doc, ry, row, rightOpt);
  }
  y = Math.max(ly, ry);

  /* ── Cuaca per jam ─────────────────────────────────────────────────── */
  const weatherCols = colWidths(width, [2.2, ...HOURS.map(() => 1)]);
  const weather: GridOptions = { x, width, cols: weatherCols, fontSize: 6.5, padX: 1.5 };
  // Matriks cuaca harus utuh dalam satu halaman (header + 3 baris kondisi).
  fit(4 * 13);
  draw(
    [
      { text: "Kondisi / Jam", head: true },
      ...HOURS.map((h): GridCell => ({ text: h, head: true, align: "center" })),
    ],
    weather,
  );
  for (const cat of ["Cerah", "Mendung", "Hujan"] as const) {
    draw(
      [
        { text: cat },
        ...HOURS.map((): GridCell => ({ text: d.activeWeather === cat ? "v" : "", align: "center" })),
      ],
      weather,
    );
  }

  /* ── Jam kerja & catatan ───────────────────────────────────────────── */
  // Jam kerja + catatan + tanda tangan juga dijaga satu blok.
  const jam: GridOptions = { x, width, cols: colWidths(width, [1, 7]), fontSize: 8 };
  fit(14 + 14 + 34 + 62);
  draw(
    [
      { text: "Jam Kerja", head: true },
      { text: `mulai ${d.workStart ?? "……"} — selesai ${d.workEnd ?? "……"}` },
    ],
    jam,
  );

  const catatan: GridOptions = { x, width, cols: [width], fontSize: 8 };
  draw([{ text: "Catatan / Keterangan", head: true }], catatan);
  draw([{ text: d.notes || " " }], { ...catatan, minRowHeight: 34 });

  /* ── Tanda tangan ──────────────────────────────────────────────────── */
  const ttd: GridOptions = { x, width, cols: colWidths(width, [1, 1]), fontSize: 8, minRowHeight: 62 };
  const nameOf = (n: string | null | undefined, sub: string | null | undefined) =>
    `\n\n\n( ${n ?? "……………………"} )${sub ? `\n${sub}` : ""}`;
  y = gridRow(
    doc,
    y,
    [
      { text: `KONSULTAN PENGAWAS${nameOf(d.supervisorName, d.supervisorSub)}`, align: "center" },
      { text: `KONTRAKTOR PELAKSANA${nameOf(d.contractorName, d.contractorSub)}`, align: "center" },
    ],
    ttd,
  );

  /* ── Catatan kaki tiap halaman ─────────────────────────────────────── */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .font(PDF_FONT.regular)
      .fontSize(6.5)
      .fillColor(PDF_COLORS.inkFaint)
      .text(
        `${appName} · ${d.isFinal ? "Laporan final" : "PRATINJAU — belum difinalisasi"}`,
        LANDSCAPE_MARGIN,
        doc.page.height - LANDSCAPE_MARGIN + 2,
        { width: width, align: "left", lineBreak: false },
      )
      .text(`Halaman ${i - range.start + 1} dari ${range.count}`, LANDSCAPE_MARGIN, doc.page.height - LANDSCAPE_MARGIN + 2, {
        width,
        align: "right",
        lineBreak: false,
      });
  }

  return docToBuffer(doc);
}

/** Muat data harian + render PDF format KKP. Null bila tak ada. TANPA otorisasi (pemanggil gate). */
export async function renderHarianKkpPdf(slug: string, dateKey: string): Promise<HarianKkpPdfResult | null> {
  const [data, branding, loc] = await Promise.all([
    getKkpDailyData(slug, dateKey),
    getBranding(),
    db.location.findUnique({ where: { slug }, select: { id: true } }),
  ]);
  if (!data || !loc) return null;
  return { buffer: await buildHarianKkpPdf(data, branding.appName), locationId: loc.id };
}
