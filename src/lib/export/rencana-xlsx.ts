import "server-only";
import ExcelJS from "exceljs";
import { LABEL_STATUS } from "@/lib/plan/rencana-format";
import type { RencanaMingguan } from "@/lib/plan/rencana-mingguan";
import { formatTanggal } from "@/lib/format";

/**
 * Ekspor Formulir Rencana Kerja Mingguan ke .xlsx (DECISIONS 258).
 *
 * Susunannya SAMA PERSIS dengan berkas cetak A4 (`kkp-weekly-plan.tsx`) — kop,
 * A posisi & proyeksi, B evaluasi PPC minggu lalu, C komitmen, D catatan — dan
 * memakai `RencanaMingguan` yang sama. Tidak ada satu pun angka yang dihitung
 * ulang di sini; berkas ini cuma menuangkan.
 *
 * Yang boleh jadi rumus Excel hanyalah SUM kolom pada baris JUMLAH, supaya
 * penerima bisa memeriksa sendiri bahwa totalnya benar penjumlahan barisnya
 * (dan supaya baris yang dihapus manual ikut mengoreksi total).
 */

const NUM_FMT = "#,##0.00";
const RP_FMT = '"Rp"#,##0';
const PCT_FMT = "0.00";

// No | Uraian | Satuan | Vol Kontrak | Realisasi | Sisa | Target | Bobot | Nilai | PIC | Catatan
const COL_WIDTHS = [5, 46, 9, 13, 13, 13, 13, 9, 16, 18, 28] as const;
const COL_COUNT = COL_WIDTHS.length; // 11

const thin = { style: "thin" as const };
const box = { top: thin, bottom: thin, left: thin, right: thin };
const HEAD_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE2E8F0" },
};
const GROUP_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF1F5F9" },
};

const round2 = (n: number) => Math.round(n * 100) / 100;
// Sel angka dibiarkan numerik (Excel memakai pemisah desimal locale pembaca);
// hanya teks bebas yang perlu diformat sendiri — dan itu pun id-ID.
const pctFmt = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const signed = (n: number) => `${n >= 0 ? "+" : "-"}${pctFmt.format(Math.abs(n))}%`;

export async function buildRencanaMingguanXlsx(r: RencanaMingguan): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.created = new Date();
  const ws = wb.addWorksheet(`Rencana Minggu ${r.weekNumber}`, {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = COL_WIDTHS.map((w) => ({ width: w }));
  const h = r.header;

  /* ── Kop ── */
  const title = (text: string, size = 12, bold = true) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, COL_COUNT);
    row.getCell(1).font = { bold, size };
    row.getCell(1).alignment = { horizontal: "center" };
  };
  title("RENCANA KERJA MINGGUAN");
  title(`Minggu Ke-${r.weekNumber} dari ${r.totalWeeks}`, 11);
  title(
    `Periode ${formatTanggal(h.periodeStart, "d MMMM yyyy")} s/d ${formatTanggal(h.periodeEnd, "d MMMM yyyy")}`,
    10,
    false,
  );
  ws.addRow([]);

  /* ── Identitas ── */
  const kv = (k: string, v: string) => {
    const row = ws.addRow([]);
    row.getCell(1).value = k;
    row.getCell(1).font = { bold: true, size: 9 };
    ws.mergeCells(row.number, 1, row.number, 2);
    const cell = row.getCell(3);
    cell.value = v;
    cell.font = { size: 9 };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    ws.mergeCells(row.number, 3, row.number, COL_COUNT);
  };
  kv("Paket Pekerjaan", h.packageName);
  kv(
    "Lokasi",
    `${h.locationName} — ${h.village}${h.district ? `, Kec. ${h.district}` : ""}, ${h.regency}, ${h.province}`,
  );
  kv("Nomor Kontrak", h.contractNumber);
  kv("Kontraktor Pelaksana", h.vendorName);
  kv("Nilai Fisik Lokasi", `Rp ${new Intl.NumberFormat("id-ID").format(Number(h.locationValue))}`);
  kv("Masa Pelaksanaan", `${h.masaPelaksanaanHari} Hari Kalender`);
  kv("Tahun Anggaran", String(h.tahunAnggaran));
  ws.addRow([]);

  /* ── A. Posisi & proyeksi ── */
  section(ws, "A. POSISI KEMAJUAN & PROYEKSI AKHIR MINGGU");
  const num = (k: string, v: number, fmt = PCT_FMT, note?: string) => {
    const row = ws.addRow([]);
    row.getCell(1).value = k;
    row.getCell(1).font = { size: 9 };
    ws.mergeCells(row.number, 1, row.number, 3);
    const cell = row.getCell(4);
    cell.value = round2(v);
    cell.numFmt = fmt;
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: "right" };
    if (note) {
      row.getCell(5).value = note;
      row.getCell(5).font = { size: 9, italic: true };
      ws.mergeCells(row.number, 5, row.number, COL_COUNT);
    }
  };
  num("Realisasi s/d saat ini (%)", r.actualPct);
  num(`Rencana kurva-S s/d minggu ${r.weekNumber} (%)`, r.targetPct);
  num("Deviasi terhadap kurva-S (%)", r.deviationPct, PCT_FMT, LABEL_STATUS[r.status]);
  num("Bobot rencana minggu ini (poin %)", r.proyeksi.tambahanPct, PCT_FMT, "= nilai komitmen / nilai fisik lokasi");
  num("Proyeksi realisasi akhir minggu ini (%)", r.proyeksi.proyeksiPct, PCT_FMT, "bila seluruh komitmen dikerjakan penuh");
  num(
    "Selisih proyeksi terhadap kurva-S (%)",
    r.proyeksi.selisihPct,
    PCT_FMT,
    r.proyeksi.masihTertinggal
      ? "MASIH TERTINGGAL — rencana ini belum cukup untuk kembali ke jadwal"
      : "cukup untuk kembali ke jadwal bila dijalankan penuh",
  );
  ws.addRow([]);

  /* ── B. PPC minggu lalu ── */
  section(ws, `B. EVALUASI KOMITMEN MINGGU KE-${r.weekNumber - 1} (PPC)`);
  if (r.ppc.pct == null) {
    const row = ws.addRow([
      "Tidak ada rencana tercatat untuk minggu sebelumnya — tidak ada komitmen yang bisa dievaluasi (bukan nilai 0%).",
    ]);
    row.getCell(1).font = { size: 9, italic: true };
    ws.mergeCells(row.number, 1, row.number, COL_COUNT);
  } else {
    num("PPC — Percent Plan Complete (%)", r.ppc.pct, PCT_FMT, `${r.ppc.tuntas} dari ${r.ppc.jumlah} komitmen tuntas`);
    if (r.ppc.volumePct != null) {
      num("Pencapaian volume (%)", r.ppc.volumePct, PCT_FMT, "pelengkap, bukan pengganti PPC");
    }
    const catatan = ws.addRow([
      "PPC dihitung per komitmen dan biner — tuntas atau tidak. Pekerjaan 80% selesai tidak melepaskan penerusnya, jadi dihitung tidak tuntas. Ambang sehat lapangan: >= 70%.",
    ]);
    catatan.getCell(1).font = { size: 8, italic: true };
    catatan.getCell(1).alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(catatan.number, 1, catatan.number, COL_COUNT);
    catatan.height = 24;

    if (r.tidakTuntas.length > 0) {
      const head = ws.addRow(["No", "Komitmen minggu lalu yang belum tuntas", "Satuan", "Target", "Terealisasi", "Kekurangan"]);
      styleHead(head, 6);
      r.tidakTuntas.forEach((t, i) => {
        const row = ws.addRow([
          i + 1,
          `${t.code} — ${t.name}`,
          t.unit ?? "",
          round2(t.target),
          round2(t.realisasi),
          round2(Math.max(0, t.target - t.realisasi)),
        ]);
        for (let c = 1; c <= 6; c++) {
          const cell = row.getCell(c);
          cell.border = box;
          cell.font = { size: 9 };
          if (c >= 4) {
            cell.numFmt = NUM_FMT;
            cell.alignment = { horizontal: "right" };
          }
        }
      });
    }
  }
  ws.addRow([]);

  /* ── C. Komitmen minggu ini ── */
  section(ws, `C. KOMITMEN PEKERJAAN MINGGU KE-${r.weekNumber}`);
  const head = ws.addRow([
    "No",
    "Uraian Pekerjaan",
    "Satuan",
    "Volume Kontrak",
    "Realisasi s/d Kini",
    "Sisa Volume",
    "Target Minggu Ini",
    "Bobot (%)",
    "Nilai (Rp)",
    "PIC",
    "Catatan",
  ]);
  styleHead(head, COL_COUNT);

  // Nomor urut menerus lintas kelompok kategori — supaya bisa diacu di rapat.
  let no = 1;
  let kategori: string | null = null;
  const dataRows: number[] = [];
  for (const b of r.baris) {
    if (b.categoryName !== kategori) {
      kategori = b.categoryName;
      const g = ws.addRow([kategori]);
      ws.mergeCells(g.number, 1, g.number, COL_COUNT);
      g.getCell(1).font = { bold: true, size: 9 };
      g.getCell(1).fill = GROUP_FILL;
      for (let c = 1; c <= COL_COUNT; c++) g.getCell(c).border = box;
    }
    const row = ws.addRow([
      no++,
      `${b.code} — ${b.name}`,
      b.unit ?? "",
      round2(b.volumeKontrak),
      round2(b.realisasi),
      round2(b.sisa),
      round2(b.target),
      round2(b.bobotTarget),
      b.nilaiTarget,
      b.picName ?? "",
      b.note ?? "",
    ]);
    dataRows.push(row.number);
    for (let c = 1; c <= COL_COUNT; c++) {
      const cell = row.getCell(c);
      cell.border = box;
      cell.font = { size: 9 };
      if (c >= 4 && c <= 8) {
        cell.numFmt = c === 8 ? PCT_FMT : NUM_FMT;
        cell.alignment = { horizontal: "right" };
      } else if (c === 9) {
        cell.numFmt = RP_FMT;
        cell.alignment = { horizontal: "right" };
      } else if (c === 2 || c === 11) {
        cell.alignment = { wrapText: true, vertical: "top" };
      }
    }
  }

  if (r.baris.length === 0) {
    const kosong = ws.addRow(["Belum ada komitmen yang dimasukkan untuk minggu ini."]);
    kosong.getCell(1).font = { size: 9, italic: true };
    ws.mergeCells(kosong.number, 1, kosong.number, COL_COUNT);
  } else {
    // Baris JUMLAH memakai SUM sungguhan, bukan angka tempelan: penerima bisa
    // memeriksa sendiri bahwa totalnya benar-benar penjumlahan baris di atasnya.
    const first = dataRows[0];
    const last = dataRows[dataRows.length - 1];
    const total = ws.addRow([]);
    total.getCell(1).value = `JUMLAH — ${r.baris.length} komitmen`;
    ws.mergeCells(total.number, 1, total.number, 7);
    total.getCell(8).value = { formula: `SUM(H${first}:H${last})` };
    total.getCell(8).numFmt = PCT_FMT;
    total.getCell(9).value = { formula: `SUM(I${first}:I${last})` };
    total.getCell(9).numFmt = RP_FMT;
    for (let c = 1; c <= COL_COUNT; c++) {
      const cell = total.getCell(c);
      cell.border = box;
      cell.font = { bold: true, size: 9 };
      cell.fill = HEAD_FILL;
      if (c >= 8) cell.alignment = { horizontal: "right" };
    }
  }
  ws.addRow([]);

  /* ── D. Catatan ── */
  section(ws, "D. CATATAN, KENDALA & KEBUTUHAN DUKUNGAN");
  const cat = ws.addRow([r.catatan?.trim() || "—"]);
  ws.mergeCells(cat.number, 1, cat.number, COL_COUNT);
  cat.getCell(1).font = { size: 9 };
  cat.getCell(1).alignment = { wrapText: true, vertical: "top" };
  cat.height = 36;
  ws.addRow([]);

  /* ── TTD ── */
  const ttdHead = ws.addRow([]);
  const kolomTtd: [number, number][] = [
    [1, 3],
    [5, 7],
    [9, COL_COUNT],
  ];
  const ttd = [
    // Penanda tangan penyedia jasa = yang DITUNJUK KONTRAK, bukan pengguna
    // aplikasi yang menyusun rencananya (lihat pdf/rencana-kkp.ts). Jejak
    // penyusun ada di baris "Dicetak dari …" di bawah.
    { title: "Disusun Oleh,", role: `Penyedia Jasa — ${h.vendorName}`, name: h.contractorSignerName, sub: h.contractorSignerTitle },
    { title: "Diperiksa,", role: "Konsultan Pengawas", name: h.supervisorName, sub: h.supervisorFirm },
    { title: "Disetujui,", role: "Pejabat Pembuat Komitmen", name: h.ppkName, sub: h.ppkNip ? `NIP. ${h.ppkNip}` : null },
  ];
  const ttdBaris = (
    row: ExcelJS.Row,
    ambil: (t: (typeof ttd)[number]) => string | null,
    font: Partial<ExcelJS.Font>,
  ) => {
    kolomTtd.forEach(([from, to], i) => {
      const cell = row.getCell(from);
      cell.value = ambil(ttd[i]) ?? "";
      cell.font = { size: 9, ...font };
      cell.alignment = { horizontal: "center" };
      ws.mergeCells(row.number, from, row.number, to);
    });
  };
  ttdBaris(ttdHead, (t) => t.title, {});
  ttdBaris(ws.addRow([]), (t) => t.role, { bold: true });
  ws.addRow([]).height = 42; // ruang tanda tangan basah
  ttdBaris(ws.addRow([]), (t) => t.name ?? "(………………………)", { bold: true, underline: true });
  ttdBaris(ws.addRow([]), (t) => t.sub, { italic: true });

  /* ── Jejak penyusunan ── */
  ws.addRow([]);
  const jejak = ws.addRow([
    `Dicetak dari MARLIN${r.disusunPada ? ` · rencana disusun ${formatTanggal(r.disusunPada, "d MMMM yyyy")}` : ""}` +
      (r.disusunOleh ? ` oleh ${r.disusunOleh}` : "") +
      ` · deviasi ${signed(r.deviationPct)} (${LABEL_STATUS[r.status]})`,
  ]);
  jejak.getCell(1).font = { size: 8, italic: true, color: { argb: "FF64748B" } };
  ws.mergeCells(jejak.number, 1, jejak.number, COL_COUNT);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function section(ws: ExcelJS.Worksheet, text: string) {
  const row = ws.addRow([text]);
  ws.mergeCells(row.number, 1, row.number, COL_COUNT);
  const cell = row.getCell(1);
  cell.font = { bold: true, size: 10 };
  cell.fill = HEAD_FILL;
  cell.border = { bottom: { style: "medium" } };
}

function styleHead(row: ExcelJS.Row, cols: number) {
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = HEAD_FILL;
    cell.border = box;
  }
  row.height = 28;
}
