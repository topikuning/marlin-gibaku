import "server-only";
import ExcelJS from "exceljs";
import type { PeriodHeader } from "@/lib/periodic-report";
import type { KurvaSheet } from "@/lib/scurve/kkp-sheet";
// TYPE-ONLY: `logo-laporan` menarik db + R2, sedangkan penulis workbook harus
// tetap tidak menyentuh basis data (pola sama dengan `xlsx.ts`).
import type { LogoLaporan } from "@/lib/export/logo-laporan";
import { colLetter } from "@/lib/export/xlsx-chart";
import { logoPasanganKanan } from "@/lib/export/xlsx-gaya";
import { type BarisRincian } from "@/lib/export/rincian-jadwal";

/**
 * TIME SCHEDULE RINCI sampai level ITEM — mengikuti BERKAS ACUAN milik user
 * ("TIME SCHEDULE PASEBAN", dikirim 2026-08-15) supaya bisa langsung dipakai &
 * dibandingkan orang sipil, bukan format karangan sendiri. DECISIONS 316.
 *
 * Tata letak acuan, dipertahankan apa adanya:
 *
 *   A: NO · B–D (gabung): JENIS PEKERJAAN · E: VOL · F: SAT · G: HARGA SATUAN
 *   H: JUMLAH HARGA · I: BOBOT · J…: minggu, dikelompokkan per BULAN
 *
 *   …lalu baris TOTAL, dan enam baris kaki:
 *   RENCANA/REALISASI/DEVIASI × (KEMAJUAN, KUMULATIF).
 *
 * ### Kenapa banyak sel berupa RUMUS, bukan angka tempelan
 *
 * Sama seperti berkas acuan — dan alasannya bukan gaya-gayaan. Berkas ini
 * DIEDIT orang sipil: menggeser sebaran mingguan satu item harus langsung
 * memperbarui bobotnya, baris RENCANA, dan kumulatifnya. Kalau semuanya angka
 * beku, berkas yang sudah diedit akan menampilkan kurva lama sambil terlihat
 * benar.
 *
 * `JUMLAH HARGA` = `VOL × HARGA SATUAN`, `BOBOT` = `JUMLAH ÷ total × 100`,
 * `RENCANA` = `SUM` kolom item — persis rantai yang dipakai acuan.
 */

/** Lebar kolom acuan (A…I), sisanya kolom minggu. */
const LEBAR_TETAP = [10.5, 18.5, 2.5, 45, 12.8, 6.5, 22.5, 26, 13.2] as const;
const LEBAR_MINGGU = 8.33;
/** Kolom minggu pertama (J). */
const KOL_MINGGU_1 = 10;

const FMT_VOL = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)';
const FMT_RP = '_-[$Rp-421]* #,##0.00_-;-[$Rp-421]* #,##0.00_-;_-[$Rp-421]* "-"??_-;_-@_-';
const FMT_PCT = "0.00";
const FONT = "Verdana";

const garis: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

type Opsi = {
  logo?: LogoLaporan;
  sheet: KurvaSheet;
  /** Sebaran mingguan per baris (sejajar `rows`); baris non-item = nol semua. */
  mingguan: number[][];
};

export async function buildRincianJadwalXlsx(
  rows: BarisRincian[],
  h: PeriodHeader,
  opts: Opsi,
): Promise<Buffer> {
  const { sheet, mingguan } = opts;
  const N = sheet.totalWeeks;
  const kolTerakhir = KOL_MINGGU_1 + N - 1;

  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.created = new Date();
  const ws = wb.addWorksheet("RAB", {
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      scale: 78,
    },
    views: [{ state: "frozen", xSplit: 9, ySplit: 10 }],
  });
  ws.columns = [
    ...LEBAR_TETAP.map((w) => ({ width: w })),
    ...Array.from({ length: N }, () => ({ width: LEBAR_MINGGU })),
  ];

  const font = (cell: ExcelJS.Cell, o: { bold?: boolean; size?: number } = {}) => {
    cell.font = { name: FONT, size: o.size ?? 10, bold: o.bold ?? false };
  };

  /* ── Kop: identitas paket, logo berjajar di kanan ───────────────────────── */
  const judul = ws.addRow(["DAFTAR KUANTITAS & HARGA"]);
  ws.mergeCells(judul.number, 1, judul.number, Math.min(kolTerakhir, 9));
  font(judul.getCell(1), { bold: true, size: 14 });
  judul.getCell(1).alignment = { horizontal: "center" };
  ws.addRow([]);

  const identitas = (label: string, nilai: string) => {
    const row = ws.addRow([label, null, ":", nilai]);
    font(row.getCell(1), { bold: true });
    font(row.getCell(3));
    font(row.getCell(4));
    ws.mergeCells(row.number, 1, row.number, 2);
    ws.mergeCells(row.number, 4, row.number, 9);
    return row;
  };
  const barisProyek = identitas("PROYEK", h.packageName);
  identitas("LOKASI", [h.village, h.regency, h.province].filter(Boolean).join(", "));
  identitas("PELAKSANA", h.vendorName);
  identitas("NO. KONTRAK", h.contractNumber);
  identitas("TAHUN ANGGARAN", String(h.tahunAnggaran));
  logoPasanganKanan(wb, ws, opts.logo, {
    rowAtas: barisProyek.number,
    tinggiPx: 46,
    kolomKiri: 10,
    kolomKanan: Math.min(kolTerakhir, KOL_MINGGU_1 + 7),
  });
  ws.addRow([]);

  /* ── Kepala tabel: 2 baris (bulan + minggu), A…I digabung menurun ───────── */
  const barisBulan = ws.addRow([]);
  const barisMinggu = ws.addRow([]);
  const judulTetap = [
    "NO",
    "JENIS PEKERJAAN",
    "",
    "",
    "VOL",
    "SAT",
    "HARGA SATUAN",
    "JUMLAH HARGA",
    "BOBOT",
  ];
  judulTetap.forEach((t, i) => {
    if (t) barisBulan.getCell(i + 1).value = t;
  });
  // A, E…I digabung MENURUN (2 baris); "JENIS PEKERJAAN" digabung menurun DAN
  // melebar (B:D × 2 baris) — satu panggilan, bukan dua (exceljs menolak sel
  // yang sudah tergabung).
  for (const c of [1, 5, 6, 7, 8, 9]) ws.mergeCells(barisBulan.number, c, barisMinggu.number, c);
  ws.mergeCells(barisBulan.number, 2, barisMinggu.number, 4);

  let kol = KOL_MINGGU_1;
  for (const g of sheet.monthGroups) {
    barisBulan.getCell(kol).value = g.label.toUpperCase();
    if (g.span > 1) ws.mergeCells(barisBulan.number, kol, barisBulan.number, kol + g.span - 1);
    kol += g.span;
  }
  // Rentang tanggal minggu ikut tercetak (2026-08-24).
  for (let i = 0; i < N; i++) barisMinggu.getCell(KOL_MINGGU_1 + i).value = `M${i + 1}\n${sheet.weekRanges[i] ?? ""}`;

  for (const row of [barisBulan, barisMinggu]) {
    for (let c = 1; c <= kolTerakhir; c++) {
      const cell = row.getCell(c);
      font(cell, { bold: true, size: 9 });
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = garis;
    }
  }

  /* ── Isi: kategori / sub / grup / item, urut seperti RAB ─────────────────── */
  const barisItem: number[] = [];
  rows.forEach((r, i) => {
    const item = r.kind === "item";
    const row = ws.addRow([]);
    row.getCell(1).value = r.code;
    row.getCell(2).value = r.name;
    ws.mergeCells(row.number, 2, row.number, 4);

    if (item) {
      row.getCell(5).value = r.volume;
      row.getCell(6).value = r.unit;
      row.getCell(7).value = r.unitPrice;
      // JUMLAH HARGA & BOBOT sebagai RUMUS — lihat catatan di kepala berkas.
      row.getCell(8).value = { formula: `E${row.number}*G${row.number}`, result: r.amount };
      barisItem.push(row.number);
      for (let w = 0; w < N; w++) {
        const v = mingguan[i]?.[w] ?? 0;
        if (v > 0) row.getCell(KOL_MINGGU_1 + w).value = v;
      }
    }

    for (let c = 1; c <= kolTerakhir; c++) {
      const cell = row.getCell(c);
      font(cell, { bold: !item });
      cell.border = garis;
      cell.alignment = { vertical: "middle" };
      if (c === 1 || c === 6) cell.alignment = { horizontal: "center", vertical: "middle" };
      else if (c === 5) cell.numFmt = FMT_VOL;
      else if (c === 7 || c === 8) cell.numFmt = FMT_RP;
      else if (c === 9 || c >= KOL_MINGGU_1) {
        cell.numFmt = FMT_PCT;
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    }
  });

  /* ── TOTAL + bobot sebagai rumus yang menunjuk baris total ──────────────── */
  const barisTotal = ws.addRow([]);
  const pertama = barisItem[0];
  const terakhir = barisItem[barisItem.length - 1];
  if (pertama && terakhir) {
    barisTotal.getCell(8).value = {
      formula: `SUM(H${pertama}:H${terakhir})`,
      result: rows.filter((r) => r.kind === "item").reduce((s, r) => s + r.amount, 0),
    };
    barisTotal.getCell(9).value = { formula: `SUM(I${pertama}:I${terakhir})`, result: 100 };
    // BOBOT tiap item menunjuk baris TOTAL — rantai yang sama dengan acuan,
    // jadi mengubah harga satuan satu item memperbarui seluruh kolom bobot.
    rows.forEach((r, i) => {
      if (r.kind !== "item") return;
      const n = barisItem[rows.slice(0, i).filter((x) => x.kind === "item").length];
      ws.getRow(n).getCell(9).value = {
        formula: `H${n}/$H$${barisTotal.number}*100`,
        result: r.bobotPct,
      };
    });
  }
  barisTotal.getCell(2).value = "JUMLAH";
  ws.mergeCells(barisTotal.number, 2, barisTotal.number, 4);
  for (let c = 1; c <= kolTerakhir; c++) {
    const cell = barisTotal.getCell(c);
    font(cell, { bold: true });
    cell.border = garis;
    if (c === 8) cell.numFmt = FMT_RP;
    if (c === 9) {
      cell.numFmt = FMT_PCT;
      cell.alignment = { horizontal: "center" };
    }
  }

  /* ── Kaki: RENCANA / REALISASI / DEVIASI × (kemajuan, kumulatif) ─────────── */
  const kolMinggu = (w: number) => colLetter(KOL_MINGGU_1 + w);
  const kaki = (
    kelompok: string,
    label: string,
    nilai: (number | null)[],
    rumus?: (w: number, barisIni: number) => string | null,
  ) => {
    const row = ws.addRow([]);
    row.getCell(2).value = kelompok;
    row.getCell(3).value = label;
    ws.mergeCells(row.number, 3, row.number, 4);
    row.getCell(6).value = "%";
    for (let w = 0; w < N; w++) {
      const f = rumus?.(w, row.number);
      const v = nilai[w];
      const cell = row.getCell(KOL_MINGGU_1 + w);
      if (f && v != null) cell.value = { formula: f, result: Number(v.toFixed(4)) };
      else if (v != null) cell.value = Number(v.toFixed(4));
    }
    for (let c = 1; c <= kolTerakhir; c++) {
      const cell = row.getCell(c);
      font(cell, { bold: true, size: 9 });
      cell.border = garis;
      cell.alignment = { horizontal: c >= KOL_MINGGU_1 || c === 6 ? "center" : "left", vertical: "middle" };
      if (c >= KOL_MINGGU_1) cell.numFmt = FMT_PCT;
    }
    return row;
  };

  const KEMAJUAN = "KEMAJUAN (PROGRES) PEKERJAAN";
  const KUMULATIF = "KUMULATIF KEMAJUAN (PROGRES) PEKERJAAN";

  /*
   * Nilai simpan baris RENCANA diambil dari SEL YANG BENAR-BENAR DITULIS,
   * bukan dari kurva resmi — aturan yang sama dengan sheet Time Schedule
   * (DECISIONS 158). Sel mingguan dibulatkan; memakai kurva resmi sebagai nilai
   * simpan sementara rumusnya `SUM(...)` berarti berkas menampilkan satu angka
   * sebelum dihitung ulang Excel dan angka lain sesudahnya.
   */
  const rencanaDitulis = Array.from({ length: N }, (_, w) =>
    Number(
      rows
        .reduce((s, r, i) => (r.kind === "item" ? s + (mingguan[i]?.[w] ?? 0) : s), 0)
        .toFixed(4),
    ),
  );
  const kumRencanaDitulis: number[] = [];
  rencanaDitulis.reduce((acc, v) => {
    const next = Number((acc + v).toFixed(4));
    kumRencanaDitulis.push(next);
    return next;
  }, 0);

  const rencana = kaki("RENCANA", KEMAJUAN, rencanaDitulis, (w) =>
    pertama && terakhir ? `SUM(${kolMinggu(w)}${pertama}:${kolMinggu(w)}${terakhir})` : null,
  );
  kaki("RENCANA", KUMULATIF, kumRencanaDitulis, (w, n) =>
    w === 0
      ? `${kolMinggu(0)}${rencana.number}`
      : `${kolMinggu(w - 1)}${n}+${kolMinggu(w)}${rencana.number}`,
  );
  const realisasi = kaki("REALISASI", KEMAJUAN, sheet.realisasiPerWeek);
  const kumRealisasi = kaki("REALISASI", KUMULATIF, sheet.kumulatifRealisasi);
  kaki(
    "DEVIASI",
    KEMAJUAN,
    sheet.realisasiPerWeek.map((v, w) => (v == null ? null : v - rencanaDitulis[w])),
    (w) => `${kolMinggu(w)}${realisasi.number}-${kolMinggu(w)}${rencana.number}`,
  );
  kaki("DEVIASI", KUMULATIF, sheet.deviasi, (w) =>
    `${kolMinggu(w)}${kumRealisasi.number}-${kolMinggu(w)}${kumRealisasi.number - 2}`,
  );

  /* ── Catatan: apa yang fakta, apa yang turunan ──────────────────────────── */
  ws.addRow([]);
  const catatan = ws.addRow([
    "Bobot tiap item dihitung dari nilai RAB-nya sendiri (fakta). Sebaran mingguan DI DALAM satu kategori adalah TURUNAN – " +
      "sistem menyimpan jadwal per KATEGORI, bukan per item, jadi tiap item disebar sebanding nilainya sepanjang jendela " +
      "kategorinya. Jumlah tiap kolom minggu tetap persis sama dengan kurva-S resmi; yang boleh disesuaikan orang sipil " +
      "adalah sebaran di dalam kategorinya.",
  ]);
  ws.mergeCells(catatan.number, 1, catatan.number, Math.min(kolTerakhir, 12));
  font(catatan.getCell(1), { size: 9 });
  catatan.getCell(1).font = { name: FONT, size: 9, italic: true };
  catatan.getCell(1).alignment = { wrapText: true, vertical: "top" };
  catatan.height = 42;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
