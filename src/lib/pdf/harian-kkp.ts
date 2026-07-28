import "server-only";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { getKkpDailyData } from "@/lib/daily-report/queries";
import { WORKER_ROLE_LABEL, WORKER_ROLE_ORDER } from "@/lib/daily-report/constants";
import { teksRealisasi, type KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { PDF_COLORS, PDF_FONT, docToBuffer, createFormA4Doc, FORM_MARGIN } from "./document";
import { colWidths, gridRow, gridRowHeight, type GridCell, type GridOptions } from "./grid";

/**
 * Laporan Harian format KKP — BLANKO RESMI, urutan blok PERSIS contoh KKP:
 * kop (logo pemilik · LAPORAN HARIAN | KONSULTAN PENGAWAS | KONTRAKTOR
 * PELAKSANA) → Minggu Ke/Hari/Tanggal → PEKERJAAN/LOKASI/TH. ANGGARAN →
 * TENAGA KERJA | REKAP PEMASUKAN BAHAN / MATERIAL (+ PERALATAN) → KONDISI
 * CUACA per jam (+ SHOP DRAWING) → Jam Kerja → RENCANA | REALISASI PEKERJAAN
 * → tanda tangan. Kemajuan per pekerjaan menyatu di kolom REALISASI.
 *
 * Tata letak mengikuti komponen web `KkpDailyReport` supaya yang dicetak dari
 * layar dan yang disetor ke Drive IDENTIK. A4 lanskap karena matriks cuaca
 * butuh 16 kolom. DECISIONS 145.
 */

const HOURS = ["07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21"];
const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const orgFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Baris kosong tercetak — blanko punya kotak siap-isi walau datanya belum ada. */
const MIN_MATERIAL_ROWS = 8;
const MIN_EQUIPMENT_ROWS = 6;
const MIN_RR_ROWS = 6;

export type HarianKkpPdfResult = { buffer: Buffer; locationId: string };

export async function buildHarianKkpPdf(d: KkpDailyData, appName: string, logo?: Buffer | null): Promise<Buffer> {
  const doc = createFormA4Doc({ title: `Laporan Harian KKP — ${d.locationName}` });
  const x = FORM_MARGIN;
  const width = doc.page.width - FORM_MARGIN * 2;
  const bottom = doc.page.height - FORM_MARGIN - 12;
  let y = FORM_MARGIN;

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
    y = FORM_MARGIN;
    repeatHeader?.();
  };

  const draw = (cells: GridCell[], o: GridOptions) => {
    fit(gridRowHeight(doc, cells, o));
    y = gridRow(doc, y, cells, o);
  };

  /* ── Kop + identitas: satu kerangka, persis blanko ───────────────────
     Blok kiri (logo · LAPORAN HARIAN, lalu Minggu/Hari/Tanggal) berakhir di
     44% lebar. Blok kanan (KONSULTAN PENGAWAS | KONTRAKTOR PELAKSANA + nama
     perusahaan) MEMANJANG ke bawah sampai sejajar baris Tanggal, jadi sisi
     kanan tidak menganga. Baru sesudah itu PEKERJAAN/LOKASI/TH. ANGGARAN
     membentang PENUH sampai tepi kanan. */
  const kiriW = width * 0.44;
  const logoW = width * 0.09;
  const labelW = width * 0.23; // kolom label = kotak logo + kolom label blanko
  const colonW = width * 0.03;
  const kananW = width - kiriW;

  const kopKiri: GridOptions = { x, width: kiriW, cols: [logoW, kiriW - logoW], fontSize: 7.5, minRowHeight: 30 };
  const kopKanan: GridOptions = { x: x + kiriW, width: kananW, cols: [kananW / 2, kananW / 2], fontSize: 7.5 };
  const identKiri: GridOptions = { x, width: kiriW, cols: [labelW, colonW, kiriW - labelW - colonW], fontSize: 7 };

  fit(30 + 3 * 13 + 3 * 13);
  const atas = y;

  // Sisi kiri: kop + tiga baris identitas.
  let ky = gridRow(doc, atas, [{ text: " " }, { text: "LAPORAN HARIAN", bold: true }], kopKiri);
  const kopBawah = ky;
  for (const [label, value] of [
    ["Minggu Ke", d.weekNo != null ? String(d.weekNo) : ""],
    ["Hari", d.hari],
    ["Tanggal", d.tanggalFull],
  ] as const) {
    ky = gridRow(doc, ky, [{ text: label }, { text: ":", align: "center" }, { text: value }], identKiri);
  }

  // Sisi kanan: judul kolom, lalu kotak nama perusahaan setinggi sisa blok kiri.
  let ny = gridRow(
    doc,
    atas,
    [
      { text: "KONSULTAN PENGAWAS", align: "center", head: true },
      { text: "KONTRAKTOR PELAKSANA", align: "center", head: true },
    ],
    { ...kopKanan, minRowHeight: kopBawah - atas },
  );
  ny = gridRow(
    doc,
    ny,
    [
      { text: d.supervisorFirm ?? " ", align: "center" },
      { text: d.contractorFirm ?? " ", align: "center" },
    ],
    { ...kopKanan, minRowHeight: Math.max(12, ky - ny) },
  );
  y = Math.max(ky, ny);

  // Logo pemilik pekerjaan dari menu Sistem — bukan hardcode KKP (DECISIONS 166).
  if (logo) {
    try {
      doc.image(logo, x + 3, atas + 3, { fit: [logoW - 6, kopBawah - atas - 6], align: "center", valign: "center" });
    } catch {
      // Logo rusak/format tak didukung tidak boleh menggagalkan laporan.
    }
  }

  const ident: GridOptions = { x, width, cols: [labelW, colonW, width - labelW - colonW], fontSize: 7 };
  const barisIdent = (label: string, value: string) =>
    draw([{ text: label }, { text: ":", align: "center" }, { text: value }], ident);
  barisIdent("PEKERJAAN", d.pekerjaan || "Konstruksi");
  barisIdent("LOKASI", `${d.locationName}, ${d.regency}, ${d.province}`);
  barisIdent("TH. ANGGARAN", String(d.tahunAnggaran));

  /* ── Tenaga kerja | Material & peralatan (berdampingan) ────────────── */
  const half = width / 2;
  const leftOpt: GridOptions = { x, width: half, cols: colWidths(half, [0.6, 4, 1, 0.5]), fontSize: 6.5 };
  const rightOpt: GridOptions = {
    x: x + half,
    width: half,
    cols: colWidths(half, [0.5, 3, 0.8, 1, 0.9]),
    fontSize: 6.5,
  };

  // Bangun daftar baris kedua sisi lebih dulu supaya bisa digambar sejajar.
  const leftRows: GridCell[][] = [
    [{ text: "TENAGA KERJA", head: true, align: "center", span: 4 }],
    [
      { text: "NO", head: true, align: "center" },
      { text: "KEAHLIAN", head: true, align: "center" },
      { text: "JMH", head: true, align: "center", span: 2 },
    ],
    ...WORKER_ROLE_ORDER.map((r, i): GridCell[] => [
      { text: String(i + 1), align: "center" },
      { text: WORKER_ROLE_LABEL[r] },
      { text: orgFmt.format(d.workerMap[r] ?? 0), align: "right" },
      { text: "org", align: "center" },
    ]),
    [
      { text: "JUMLAH", span: 2, align: "center", bold: true },
      { text: orgFmt.format(d.totalWorkers), align: "right", bold: true },
      { text: "org", align: "center", bold: true },
    ],
  ];

  const barisMaterial = Math.max(MIN_MATERIAL_ROWS, d.materials.length);
  const barisPeralatan = Math.max(MIN_EQUIPMENT_ROWS, d.equipment.length);
  const matRows: GridCell[][] = [
    [{ text: "REKAP PEMASUKAN BAHAN / MATERIAL", head: true, align: "center", span: 5 }],
    [
      { text: "NO", head: true, align: "center" },
      { text: "JENIS MATERIAL / BAHAN", head: true, align: "center" },
      { text: "SATUAN", head: true, align: "center" },
      { text: "DITERIMA", head: true, align: "center" },
      // Ditolak: ada di blanko, belum ada inputnya — dikosongkan (keputusan user).
      { text: "DITOLAK", head: true, align: "center" },
    ],
    ...Array.from({ length: barisMaterial }, (_, i): GridCell[] => {
      const m = d.materials[i];
      return [
        { text: String(i + 1), align: "center" },
        { text: m?.name ?? " " },
        { text: m?.unit ?? " ", align: "center" },
        { text: m && m.qty != null ? volFmt.format(m.qty) : " ", align: "right" },
        { text: " " },
      ];
    }),
    [{ text: "PERALATAN", head: true, align: "center", span: 5 }],
    [
      { text: "NO", head: true, align: "center" },
      { text: "NAMA PERALATAN", head: true, align: "center", span: 3 },
      { text: "JUMLAH", head: true, align: "center" },
    ],
    ...Array.from({ length: barisPeralatan }, (_, i): GridCell[] => {
      const e = d.equipment[i];
      return [
        { text: String(i + 1), align: "center" },
        { text: e?.name ?? " ", span: 3 },
        { text: e ? String(e.count) : " ", align: "center" },
      ];
    }),
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

  /* ── Kondisi cuaca per jam ─────────────────────────────────────────── */
  const weatherCols = colWidths(width, [2.2, ...HOURS.map(() => 1), 1.8]);
  const weather: GridOptions = { x, width, cols: weatherCols, fontSize: 5.5, padX: 1 };
  // Matriks cuaca harus utuh dalam satu halaman (2 header + 3 baris kondisi).
  fit(5 * 13);
  draw(
    [
      { text: "KONDISI CUACA", head: true, align: "center", span: HOURS.length + 1 },
      // Shop drawing: ada di blanko, belum ada datanya — dikosongkan.
      { text: "SHOP DRAWING", head: true, align: "center" },
    ],
    weather,
  );
  draw(
    [
      { text: "KONDISI / JAM", head: true, align: "center" },
      ...HOURS.map((h): GridCell => ({ text: `${h}.00`, head: true, align: "center" })),
      { text: " ", head: true },
    ],
    weather,
  );
  for (const cat of ["Cerah", "Mendung", "Hujan"] as const) {
    draw(
      [
        { text: cat, align: "center" },
        ...HOURS.map((): GridCell => ({ text: d.activeWeather === cat ? "v" : "", align: "center" })),
        { text: "", align: "center" },
      ],
      weather,
    );
  }

  /* ── Jam kerja ─────────────────────────────────────────────────────── */
  const jam: GridOptions = { x, width, cols: [labelW + colonW, width - labelW - colonW], fontSize: 7 };
  draw(
    [
      { text: "Jam Kerja", head: true },
      { text: `mulai ${d.workStart ?? "……"} — selesai ${d.workEnd ?? "……"}` },
    ],
    jam,
  );

  /* ── Rencana | realisasi pekerjaan (dua kolom, mengikuti blanko) ────
     Uraian pekerjaan + kemajuannya menyatu di kolom REALISASI — tidak ada
     tabel progres terpisah (keputusan user 28 Juli 2026). */
  const rrHalf = width / 2;
  const rrLeft: GridOptions = { x, width: rrHalf, cols: colWidths(rrHalf, [0.5, 6]), fontSize: 6.5 };
  const rrRight: GridOptions = { x: x + rrHalf, width: rrHalf, cols: colWidths(rrHalf, [0.5, 6]), fontSize: 6.5 };
  const rencanaTeks = (d.rencana ?? []).map(
    (r) =>
      `${r.name}${r.volume > 0 ? ` — ${volFmt.format(r.volume)}${r.unit ? ` ${r.unit}` : ""}` : ""}` +
      (r.picName ? ` (${r.picName})` : ""),
  );
  const realisasiTeks = d.items.map((it) => teksRealisasi(it));
  const barisRR = Math.max(MIN_RR_ROWS, rencanaTeks.length, realisasiTeks.length);
  fit(14 * (barisRR + 1));
  const rrTop = y;
  let rly = gridRow(doc, rrTop, [{ text: "RENCANA PEKERJAAN", head: true, align: "center", span: 2 }], rrLeft);
  for (let i = 0; i < barisRR; i++) {
    const teks = rencanaTeks[i];
    rly = gridRow(doc, rly, [{ text: String(i + 1), align: "center" }, { text: teks ?? " " }], rrLeft);
  }
  let rry = gridRow(doc, rrTop, [{ text: "REALISASI PEKERJAAN", head: true, align: "center", span: 2 }], rrRight);
  for (let i = 0; i < barisRR; i++) {
    const teks = realisasiTeks[i];
    rry = gridRow(doc, rry, [{ text: String(i + 1), align: "center" }, { text: teks ?? " " }], rrRight);
  }
  y = Math.max(rly, rry);

  /* ── Catatan (data sistem, di luar blanko) & tanda tangan ──────────── */
  const catatan: GridOptions = { x, width, cols: [width], fontSize: 7 };
  fit(14 + 34 + 70);
  draw([{ text: "CATATAN / KETERANGAN", head: true }], catatan);
  draw([{ text: d.notes || " " }], { ...catatan, minRowHeight: 34 });

  const ttd: GridOptions = { x, width, cols: colWidths(width, [1, 1]), fontSize: 7, minRowHeight: 70 };
  const blokTtd = (judul: string, peran: string, firm: string | null | undefined, nama: string | null | undefined, sub: string) =>
    `${judul}\n${peran}${firm ? `\n${firm}` : ""}\n\n\n( ${nama ?? "……………………"} )\n${sub}`;
  y = gridRow(
    doc,
    y,
    [
      {
        text: blokTtd("Disetujui Oleh;", "Konsultan Pengawas", d.supervisorFirm ?? d.supervisorSub, d.supervisorName, "Inspector"),
        align: "center",
      },
      {
        text: blokTtd("Dibuat Oleh :", "Kontraktor Pelaksana", d.contractorFirm, d.contractorName, d.contractorSub || "Pelaksana"),
        align: "center",
      },
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
        FORM_MARGIN,
        doc.page.height - FORM_MARGIN + 2,
        { width: width, align: "left", lineBreak: false },
      )
      .text(`Halaman ${i - range.start + 1} dari ${range.count}`, FORM_MARGIN, doc.page.height - FORM_MARGIN + 2, {
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
  // Logo pemilik untuk kop; kegagalan R2 tidak boleh menggagalkan laporan.
  let logo: Buffer | null = null;
  if (branding.ownerLogoKey) {
    try {
      const { r2GetBuffer } = await import("@/lib/r2");
      logo = await r2GetBuffer(branding.ownerLogoKey);
    } catch {
      logo = null;
    }
  }
  return { buffer: await buildHarianKkpPdf(data, branding.appName, logo), locationId: loc.id };
}
