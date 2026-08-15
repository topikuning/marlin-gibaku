import "server-only";
import ExcelJS from "exceljs";
import type { PeriodHeader } from "@/lib/periodic-report";
// TYPE-ONLY: `logo-laporan` menarik db + R2, sedangkan penulis workbook harus
// tetap tidak menyentuh basis data (pola sama dengan `xlsx.ts`).
import type { LogoLaporan } from "@/lib/export/logo-laporan";
import {
  FMT_ANGKA,
  FMT_RUPIAH,
  KOTAK,
  WARNA,
  blokTandaTangan,
  gayaKepala,
  isi,
  logoPasanganKanan,
} from "@/lib/export/xlsx-gaya";
import { formatTanggal } from "@/lib/format";
import { totalBobotKategori, totalNilaiKategori, type BarisRincian } from "@/lib/export/rincian-jadwal";

/**
 * RINCIAN TIME SCHEDULE sampai level ITEM sebagai .xlsx berkop resmi
 * (DECISIONS 316) — pendamping "Unduh Excel Jadwal" yang hanya sampai kategori.
 *
 * Berkop & bertanda tangan karena tujuannya SETORAN ke pemberi kerja (pilihan
 * user), mengikuti tata letak sheet Time Schedule: identitas paket di kiri,
 * pasangan logo pemilik + kontraktor berjajar di kanan.
 *
 * Satu hal yang TIDAK boleh hilang dari berkas ini: peringatan bahwa kolom
 * waktu adalah jadwal KATEGORI, bukan jadwal item. Tanpa itu, dokumen yang
 * disetorkan akan terbaca sebagai pernyataan kapan tiap item dikerjakan —
 * pernyataan yang tidak pernah dibuat siapa pun.
 */

const KOLOM = [6, 46, 11, 8, 16, 18, 10, 22, 26] as const;
const JUMLAH_KOLOM = KOLOM.length;

type Opsi = { logo?: LogoLaporan; totalWeeks: number; origin: "tersimpan" | "otomatis" };

export async function buildRincianJadwalXlsx(
  rows: BarisRincian[],
  h: PeriodHeader,
  opts: Opsi,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.created = new Date();

  const ws = wb.addWorksheet("Rincian Time Schedule", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: 0, xSplit: 2 }],
  });
  ws.columns = KOLOM.map((w) => ({ width: w }));

  const banner = (teks: string, bold: boolean, size: number, warna: string) => {
    const row = ws.addRow([teks]);
    ws.mergeCells(row.number, 1, row.number, JUMLAH_KOLOM);
    row.getCell(1).font = { bold, size, color: { argb: warna } };
    row.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    return row;
  };

  const barisJudul = banner("RINCIAN TIME SCHEDULE — SAMPAI URAIAN ITEM", true, 12, WARNA.kepala);
  banner(`${h.packageName} — ${h.village}, ${h.regency}`, false, 10, WARNA.teksRedup);
  banner(
    `Kontrak ${h.contractNumber} · ${h.vendorName} · masa pelaksanaan ${h.masaPelaksanaanHari} hari (${opts.totalWeeks} minggu)`,
    false,
    9,
    WARNA.teksRedup,
  );
  ws.getRow(barisJudul.number + 1).height = 34;
  logoPasanganKanan(wb, ws, opts.logo, {
    rowAtas: barisJudul.number,
    tinggiPx: 44,
    kolomKiri: 1,
    kolomKanan: JUMLAH_KOLOM,
  });
  ws.addRow([]);

  /*
   * PERINGATAN ISI, bukan catatan kaki. Ditaruh SEBELUM tabel dan diberi warna
   * supaya terbaca oleh orang yang cuma melihat halaman pertama — bukan setelah
   * ratusan baris item, tempat ia tidak akan pernah ditemukan.
   */
  const catatan = ws.addRow([
    "Bobot tiap baris dihitung dari nilai RAB-nya sendiri. Kolom JADWAL adalah jadwal KATEGORI INDUK — " +
      "sistem tidak menyimpan jadwal per item, jadi kolom itu TIDAK menyatakan kapan item tersebut dikerjakan.",
  ]);
  ws.mergeCells(catatan.number, 1, catatan.number, JUMLAH_KOLOM);
  catatan.getCell(1).font = { size: 9, italic: true, color: { argb: WARNA.teks } };
  catatan.getCell(1).alignment = { wrapText: true, vertical: "middle" };
  catatan.getCell(1).fill = isi(WARNA.identitas);
  catatan.height = 26;
  ws.addRow([]);

  const kepala = ws.addRow([
    "Kode",
    "Uraian Pekerjaan",
    "Volume",
    "Satuan",
    "Harga Satuan",
    "Jumlah (Rp)",
    "Bobot (%)",
    "Jadwal (minggu kategori)",
    "Kategori induk",
  ]);
  kepala.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > JUMLAH_KOLOM) return;
    gayaKepala(cell, { size: 9 });
  });
  ws.autoFilter = {
    from: { row: kepala.number, column: 1 },
    to: { row: kepala.number, column: JUMLAH_KOLOM },
  };

  for (const r of rows) {
    const row = ws.addRow([
      r.code,
      // Indentasi lewat spasi, bukan `alignment.indent`: berkas ini sering
      // disalin ke sheet lain, dan indentasi sel tidak ikut tersalin sedangkan
      // teksnya ikut.
      `${"    ".repeat(r.level)}${r.name}`,
      r.volume,
      r.unit,
      r.unitPrice,
      r.amount,
      r.bobotPct,
      r.jadwal,
      r.kind === "kategori" ? "" : r.kategori,
    ]);
    const kategori = r.kind === "kategori";
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > JUMLAH_KOLOM) return;
      cell.border = KOTAK;
      cell.font = { size: 8, bold: kategori };
      if (kategori) cell.fill = isi(WARNA.kategori);
      if (col === 1 || col === 4) cell.alignment = { horizontal: "center" };
      else if (col === 3) { cell.alignment = { horizontal: "right" }; cell.numFmt = FMT_ANGKA; }
      else if (col === 5 || col === 6) { cell.alignment = { horizontal: "right" }; cell.numFmt = FMT_RUPIAH; }
      else if (col === 7) { cell.alignment = { horizontal: "right" }; cell.numFmt = "#,##0.000"; }
      else if (col === 8) cell.alignment = { horizontal: "center" };
    });
  }

  // TOTAL hanya menjumlah baris KATEGORI — sub/grup/item adalah anaknya, dan
  // menjumlahkan semuanya menghasilkan 200%+ (lihat `rincian-jadwal.ts`).
  const total = ws.addRow([
    "",
    "TOTAL (Σ kategori)",
    null,
    null,
    null,
    totalNilaiKategori(rows),
    totalBobotKategori(rows),
    "",
    "",
  ]);
  total.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > JUMLAH_KOLOM) return;
    cell.border = KOTAK;
    cell.font = { size: 9, bold: true };
    cell.fill = isi(WARNA.total);
    if (col === 6) { cell.alignment = { horizontal: "right" }; cell.numFmt = FMT_RUPIAH; }
    if (col === 7) { cell.alignment = { horizontal: "right" }; cell.numFmt = "#,##0.000"; }
  });

  ws.addRow([]);
  const asal = ws.addRow([
    opts.origin === "tersimpan"
      ? "Sumber jadwal: baseline kurva-S yang aktif."
      : "Sumber jadwal: derivasi otomatis — baseline belum punya jadwal tersimpan untuk revisi RAB ini.",
  ]);
  ws.mergeCells(asal.number, 1, asal.number, JUMLAH_KOLOM);
  asal.getCell(1).font = { size: 8, italic: true, color: { argb: WARNA.teksRedup } };

  const dicetak = ws.addRow([`Dicetak ${formatTanggal(new Date(), "d MMMM yyyy")} dari MARLIN.`]);
  ws.mergeCells(dicetak.number, 1, dicetak.number, JUMLAH_KOLOM);
  dicetak.getCell(1).font = { size: 8, italic: true, color: { argb: WARNA.teksRedup } };

  ws.addRow([]);
  blokTandaTangan(ws, { lastCol: JUMLAH_KOLOM, h });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
