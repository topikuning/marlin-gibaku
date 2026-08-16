import "server-only";
import { getBranding } from "@/lib/branding";
import { LABEL_STATUS } from "@/lib/plan/rencana-format";
import { getRencanaMingguan, type RencanaMingguan } from "@/lib/plan/rencana-mingguan";
import { jejakPenyusun, pihakTandaTanganRencana } from "@/lib/plan/rencana-ttd";
import { PDF_COLORS, PDF_FONT, docToBuffer, createFormA4Doc, FORM_MARGIN } from "./document";
import { colWidths, gridRow, gridRowHeight, type GridCell, type GridOptions } from "./grid";
import { gambarTtdPdf, muatTtdPdf, TANPA_TTD_PDF, type TtdPdf } from "./ttd-gambar";

/**
 * FORMULIR RENCANA KERJA MINGGUAN — PDF A4 potret (DECISIONS 258).
 *
 * Cermin komponen layar `KkpWeeklyPlan`: kop → identitas → A posisi & proyeksi
 * → B evaluasi PPC minggu lalu → C komitmen → D catatan → tanda tangan tiga
 * pihak. Angkanya dari `getRencanaMingguan` — sumber yang SAMA dengan layar,
 * halaman cetak, dan Excel.
 *
 * PDF ada supaya rencana bisa dikirim lewat WhatsApp dan DIBACA di HP. Berkas
 * Excel praktis tidak bisa dibuka mandor di lapangan; foto layar tidak bisa
 * ditandatangani. Yang beredar ke grup harus dokumen yang sama dengan yang
 * disetujui.
 */

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupiah = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
const p2 = (n: number) => `${pctFmt.format(n)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${pctFmt.format(Math.abs(n))}%`;
/** Bobot bukan nol yang membulat ke 0,00 ditulis apa adanya, bukan "0,00". */
const bobot = (n: number) => (n <= 0 ? "–" : n < 0.005 ? "< 0,01" : pctFmt.format(n));
const tgl = (d: Date) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(d);
const satuan = (n: number, unit: string | null) => `${volFmt.format(n)}${unit ? ` ${unit}` : ""}`;

export type RencanaKkpPdfResult = { buffer: Buffer; locationId: string };

export async function buildRencanaKkpPdf(
  r: RencanaMingguan,
  appName: string,
  /** Gambar tanda tangan & stempel (DECISIONS 328); null = ruang kosong. */
  gambarTtd?: TtdPdf | null,
): Promise<Buffer> {
  const doc = createFormA4Doc({
    title: `Rencana Kerja Mingguan — Minggu ke-${r.weekNumber} — ${r.header.locationName}`,
  });
  const x = FORM_MARGIN;
  const width = doc.page.width - FORM_MARGIN * 2;
  const bottom = doc.page.height - FORM_MARGIN - 14;
  const h = r.header;
  let y = FORM_MARGIN;

  // Paginasi manual (sama seperti blanko harian/periodik): tanpa ini, teks dekat
  // margin bawah memicu halaman kosong dari pdfkit.
  const noAutoBreak = () => {
    doc.page.margins.bottom = 0;
  };
  noAutoBreak();
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

  /* ── Kop ── */
  doc.font(PDF_FONT.bold).fontSize(13).fillColor(PDF_COLORS.ink);
  doc.text("RENCANA KERJA MINGGUAN", x, y, { width, align: "center" });
  y += 17;
  doc.fontSize(10).text(`Minggu Ke-${r.weekNumber}`, x, y, { width, align: "center" });
  y += 13;
  doc.font(PDF_FONT.regular).fontSize(8).fillColor(PDF_COLORS.inkMuted);
  doc.text(`Periode ${tgl(h.periodeStart)} s/d ${tgl(h.periodeEnd)}`, x, y, { width, align: "center" });
  y += 12;
  doc.moveTo(x, y).lineTo(x + width, y).lineWidth(1).strokeColor(PDF_COLORS.ink).stroke();
  y += 8;

  /* ── Identitas: dua pasang label/nilai per baris ── */
  const identCols = colWidths(width, [1.5, 2.6, 1.5, 2.6]);
  const ident: GridOptions = { x, width, cols: identCols, fontSize: 7.5 };
  const identBaris: [string, string, string, string][] = [
    ["Paket Pekerjaan", h.packageName, "Masa Pelaksanaan", `${h.masaPelaksanaanHari} Hari Kalender`],
    [
      "Lokasi",
      `${h.locationName} — ${h.village}${h.district ? `, Kec. ${h.district}` : ""}, ${h.regency}, ${h.province}`,
      "Nilai Fisik Lokasi",
      rupiah(Number(h.locationValue)),
    ],
    ["Nomor Kontrak", h.contractNumber, "Kontraktor Pelaksana", h.vendorName],
    [
      "Tahun Anggaran",
      String(h.tahunAnggaran),
      "Minggu ke",
      `${r.weekNumber} dari ${r.totalWeeks}${r.weekNumber === r.currentWeek ? " (berjalan)" : ""}`,
    ],
  ];
  for (const [k1, v1, k2, v2] of identBaris) {
    draw(
      [
        { text: k1, head: true },
        { text: v1 },
        { text: k2, head: true },
        { text: v2 },
      ],
      ident,
    );
  }
  y += 8;

  /* ── A. Posisi & proyeksi ── */
  judul("A. POSISI KEMAJUAN & PROYEKSI AKHIR MINGGU");
  const empatCols = colWidths(width, [1, 1, 1, 1]);
  const empat: GridOptions = { x, width, cols: empatCols, fontSize: 7 };
  draw(
    [
      { text: "Realisasi s/d saat ini", head: true, align: "center" },
      { text: `Rencana kurva-S s/d minggu ${r.weekNumber}`, head: true, align: "center" },
      { text: "Deviasi terhadap kurva-S", head: true, align: "center" },
      { text: "Bobot rencana minggu ini", head: true, align: "center" },
    ],
    empat,
  );
  draw(
    [
      { text: p2(r.actualPct), bold: true, align: "center" },
      { text: p2(r.targetPct), bold: true, align: "center" },
      { text: `${signed(r.deviationPct)} · ${LABEL_STATUS[r.status]}`, bold: true, align: "center" },
      { text: `${signed(r.proyeksi.tambahanPct)} · ${rupiah(r.totalNilai)}`, bold: true, align: "center" },
    ],
    { ...empat, fontSize: 8 },
  );

  // Kalimat proyeksi ditulis PENUH — inilah satu hal yang harus terbaca oleh
  // orang yang menandatangani, bukan sekadar angka dalam kotak.
  const proyeksiTeks =
    `Bila seluruh komitmen dalam formulir ini dikerjakan penuh, realisasi pada akhir minggu ke-${r.weekNumber} ` +
    `menjadi ${p2(r.proyeksi.proyeksiPct)}, sedangkan kurva-S menuntut ${p2(r.proyeksi.targetPct)} — ` +
    (r.proyeksi.masihTertinggal
      ? `MASIH TERTINGGAL ${p2(Math.abs(r.proyeksi.selisihPct))}. Rencana ini belum cukup untuk kembali ke ` +
        `jadwal; perlu tambahan sumber daya, perpanjangan jam kerja, atau penyesuaian jadwal yang disepakati.`
      : `menutup ketertinggalan dengan selisih ${signed(r.proyeksi.selisihPct)}. Rencana ini cukup untuk ` +
        `kembali ke jadwal bila dijalankan penuh.`);
  draw([{ text: `Proyeksi: ${proyeksiTeks}` }], { x, width, cols: [width], fontSize: 7.5 });
  y += 8;

  /* ── B. PPC minggu lalu ── */
  judul(`B. EVALUASI KOMITMEN MINGGU KE-${r.weekNumber - 1} (PPC)`);
  if (r.ppc.pct == null) {
    draw(
      [
        {
          text:
            "Tidak ada rencana tercatat untuk minggu sebelumnya — tidak ada komitmen yang bisa " +
            "dievaluasi. Ini bukan nilai 0%.",
        },
      ],
      { x, width, cols: [width], fontSize: 7.5 },
    );
  } else {
    const ppcCols = colWidths(width, [1, 1, 2.4]);
    const ppcOpt: GridOptions = { x, width, cols: ppcCols, fontSize: 7 };
    draw(
      [
        { text: "PPC (Percent Plan Complete)", head: true, align: "center" },
        { text: "Pencapaian volume", head: true, align: "center" },
        { text: "Cara membacanya", head: true, align: "center" },
      ],
      ppcOpt,
    );
    draw(
      [
        { text: `${p2(r.ppc.pct)} — ${r.ppc.tuntas} dari ${r.ppc.jumlah} komitmen tuntas`, bold: true, align: "center" },
        { text: r.ppc.volumePct == null ? "—" : `${p2(r.ppc.volumePct)} (pelengkap)`, align: "center" },
        {
          text:
            "PPC dihitung per komitmen dan biner — tuntas atau tidak. Pekerjaan yang baru 80% selesai " +
            "tidak melepaskan penerusnya, jadi dihitung tidak tuntas. Ambang sehat lapangan: 70%.",
        },
      ],
      ppcOpt,
    );

    if (r.tidakTuntas.length > 0) {
      const ttCols = colWidths(width, [0.4, 4, 1.1, 1.1, 1.1]);
      const ttOpt: GridOptions = { x, width, cols: ttCols, fontSize: 7 };
      const ttHead = () =>
        (y = gridRow(
          doc,
          y,
          [
            { text: "No", head: true, align: "center" },
            { text: "Komitmen minggu lalu yang belum tuntas", head: true },
            { text: "Target", head: true, align: "center" },
            { text: "Terealisasi", head: true, align: "center" },
            { text: "Kekurangan", head: true, align: "center" },
          ],
          ttOpt,
        ));
      fit(30, ttHead);
      ttHead();
      r.tidakTuntas.forEach((t, i) => {
        const cells: GridCell[] = [
          { text: String(i + 1), align: "right" },
          { text: `${t.code} · ${t.name}` },
          { text: satuan(t.target, t.unit), align: "right" },
          { text: satuan(t.realisasi, t.unit), align: "right" },
          { text: satuan(Math.max(0, t.target - t.realisasi), t.unit), align: "right" },
        ];
        fit(gridRowHeight(doc, cells, ttOpt), ttHead);
        y = gridRow(doc, y, cells, ttOpt);
      });
    }
  }
  y += 8;

  /* ── C. Komitmen minggu ini ── */
  judul(`C. KOMITMEN PEKERJAAN MINGGU KE-${r.weekNumber}`);
  if (r.baris.length === 0) {
    draw([{ text: "Belum ada komitmen yang dimasukkan untuk minggu ini." }], {
      x,
      width,
      cols: [width],
      fontSize: 7.5,
    });
  } else {
    const kCols = colWidths(width, [0.4, 3.4, 0.6, 0.85, 0.85, 0.85, 0.9, 0.65, 1.4, 1]);
    const kOpt: GridOptions = { x, width, cols: kCols, fontSize: 6.8 };
    const kHead = () => {
      y = gridRow(
        doc,
        y,
        [
          { text: "No", head: true, align: "center" },
          { text: "Uraian Pekerjaan", head: true },
          { text: "Sat.", head: true, align: "center" },
          { text: "Vol. Kontrak", head: true, align: "center" },
          { text: "Realisasi", head: true, align: "center" },
          { text: "Sisa", head: true, align: "center" },
          { text: "Target Mgg Ini", head: true, align: "center" },
          { text: "Bobot", head: true, align: "center" },
          { text: "Nilai", head: true, align: "center" },
          { text: "PIC", head: true, align: "center" },
        ],
        kOpt,
      );
    };
    fit(34, kHead);
    kHead();

    // Nomor urut MENERUS lintas kelompok kategori, supaya bisa diacu di rapat.
    let no = 1;
    let kategori: string | null = null;
    for (const b of r.baris) {
      if (b.categoryName !== kategori) {
        kategori = b.categoryName;
        const gCells: GridCell[] = [{ text: kategori, span: 10, bold: true }];
        fit(gridRowHeight(doc, gCells, kOpt), kHead);
        y = gridRow(doc, y, gCells, kOpt);
      }
      const cells: GridCell[] = [
        { text: String(no++), align: "right" },
        { text: `${b.code} · ${b.name}${b.note?.trim() ? `\nCatatan: ${b.note}` : ""}` },
        { text: b.unit ?? "—", align: "center" },
        { text: volFmt.format(b.volumeKontrak), align: "right" },
        { text: b.realisasi > 0 ? volFmt.format(b.realisasi) : "–", align: "right" },
        { text: volFmt.format(b.sisa), align: "right" },
        { text: volFmt.format(b.target), align: "right", bold: true },
        { text: bobot(b.bobotTarget), align: "right" },
        { text: rupiah(b.nilaiTarget), align: "right" },
        { text: b.picName ?? "—" },
      ];
      fit(gridRowHeight(doc, cells, kOpt), kHead);
      y = gridRow(doc, y, cells, kOpt);
    }
    const totalCells: GridCell[] = [
      { text: `JUMLAH — ${r.baris.length} komitmen`, span: 7, bold: true, align: "right" },
      { text: p2(r.totalBobot), bold: true, align: "right" },
      { text: rupiah(r.totalNilai), bold: true, align: "right" },
      { text: "" },
    ];
    fit(gridRowHeight(doc, totalCells, kOpt), kHead);
    y = gridRow(doc, y, totalCells, kOpt);

    y += 3;
    const catatanKaki =
      `Kolom Bobot = nilai target dibagi nilai fisik lokasi (${rupiah(Number(h.locationValue))}), dalam poin persen — ` +
      `dasar yang sama dengan kurva-S dan laporan mingguan KKP. Kolom Realisasi = volume kumulatif s/d formulir ini disusun.`;
    doc.font(PDF_FONT.regular).fontSize(6).fillColor(PDF_COLORS.inkMuted);
    // Tinggi DIUKUR, bukan ditebak: catatan ini membungkus jadi 2–3 baris
    // tergantung panjang nilai kontrak, dan tebakan tetap membuatnya menempel
    // ke judul bagian berikutnya pada lokasi bernilai besar.
    const tinggiCatatan = doc.heightOfString(catatanKaki, { width });
    fit(tinggiCatatan + 6);
    doc.text(catatanKaki, x, y, { width });
    y += tinggiCatatan + 6;
  }

  /* ── D. Catatan ── */
  judul("D. CATATAN, KENDALA & KEBUTUHAN DUKUNGAN");
  draw([{ text: r.catatan?.trim() || " " }], {
    x,
    width,
    cols: [width],
    fontSize: 7.5,
    minRowHeight: 34,
  });
  y += 14;

  /* ── Tanda tangan ── */
  const ttd = pihakTandaTanganRencana(r);
  fit(96);
  const kolom = width / 3;
  const atasTtd = y;
  ttd.forEach((t, i) => {
    const cx = x + i * kolom;
    let cy = atasTtd;
    doc.font(PDF_FONT.regular).fontSize(7.5).fillColor(PDF_COLORS.inkMuted);
    doc.text(t.title, cx, cy, { width: kolom, align: "center" });
    cy += 11;
    doc.font(PDF_FONT.bold).fillColor(PDF_COLORS.ink);
    doc.text(t.role, cx, cy, { width: kolom, align: "center" });
    cy += 48; // ruang tanda tangan basah
    // Tempel gambar tanda tangan & stempel di ruang itu (DECISIONS 328).
    // Pihaknya dibaca dari `t.pihak`, BUKAN dari indeks `i`: kalau urutan blok
    // diubah, mencocokkan lewat indeks akan menempelkan stempel PPK di kolom
    // penyedia — dan itu baru ketahuan setelah dokumennya beredar.
    if (gambarTtd) {
      // 40 poin ≈ 1,4 cm; muat di ruang 48 poin di atas garisnya.
      gambarTtdPdf(doc, gambarTtd[t.pihak], {
        xTengah: cx + kolom / 2,
        yDasar: cy,
        lebarKolom: kolom,
        tinggiCelah: 40,
      });
    }
    doc
      .moveTo(cx + kolom * 0.12, cy)
      .lineTo(cx + kolom * 0.88, cy)
      .lineWidth(0.5)
      .strokeColor(PDF_COLORS.inkMuted)
      .stroke();
    cy += 3;
    doc.font(PDF_FONT.bold).fontSize(7.5).fillColor(PDF_COLORS.ink);
    doc.text(t.name ?? "(………………………)", cx, cy, { width: kolom, align: "center" });
    cy += 10;
    if (t.sub) {
      doc.font(PDF_FONT.regular).fontSize(6.5).fillColor(PDF_COLORS.inkMuted);
      doc.text(t.sub, cx, cy, { width: kolom, align: "center" });
    }
  });

  /* ── Footer tiap halaman ── */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.font(PDF_FONT.regular).fontSize(6.5).fillColor(PDF_COLORS.inkFaint);
    const penyusun = jejakPenyusun(r, tgl);
    const jejak =
      `${appName} · ${h.locationName} · Rencana minggu ke-${r.weekNumber}` +
      (penyusun ? ` · ${penyusun}` : "");
    doc.text(jejak, FORM_MARGIN, doc.page.height - FORM_MARGIN + 2, {
      width,
      lineBreak: false,
    });
    doc.text(`Halaman ${i - range.start + 1} dari ${range.count}`, FORM_MARGIN, doc.page.height - FORM_MARGIN + 2, {
      width,
      align: "right",
      lineBreak: false,
    });
  }

  return docToBuffer(doc);

  function judul(teks: string) {
    fit(16);
    doc.font(PDF_FONT.bold).fontSize(8).fillColor(PDF_COLORS.ink);
    doc.text(teks, x, y, { width });
    y += 10;
    doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.5).strokeColor(PDF_COLORS.inkMuted).stroke();
    y += 3;
  }
}

/**
 * Muat data rencana + render PDF. Null bila prasyarat belum ada.
 * TANPA otorisasi — pemanggil yang menggerbangi (sama seperti renderHarianKkpPdf).
 */
export async function renderRencanaKkpPdf(
  locationId: string,
  weekNumber: number,
): Promise<RencanaKkpPdfResult | null> {
  const [rencana, branding] = await Promise.all([
    getRencanaMingguan(locationId, weekNumber),
    getBranding(),
  ]);
  if (!rencana) return null;
  // Best-effort, sama dengan logo: kegagalannya menghasilkan ruang kosong,
  // bukan PDF yang gagal terbit.
  const gambarTtd = await muatTtdPdf(locationId).catch(() => TANPA_TTD_PDF);
  return {
    buffer: await buildRencanaKkpPdf(rencana, branding.appName, gambarTtd),
    locationId,
  };
}
