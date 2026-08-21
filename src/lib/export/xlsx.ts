import "server-only";
import type { JenisDokumen } from "@/lib/laporan/penandatangan";
import ExcelJS from "exceljs";
import type { PeriodReport } from "@/lib/periodic-report";
import { buildKurvaSheet } from "@/lib/scurve/kkp-sheet";
import { addLineChartToXlsx, colLetter, type LineChartSpec } from "@/lib/export/xlsx-chart";
// TYPE-ONLY: `logo-laporan` menarik db + R2 (pemuatnya), sedangkan berkas ini
// harus tetap murni — penulis workbook TIDAK boleh menyentuh basis data.
import type { LogoLaporan } from "@/lib/export/logo-laporan";
import {
  FMT_ANGKA,
  FMT_PERSEN,
  FMT_RUPIAH,
  KOTAK,
  KOTAK_HALUS,
  WARNA,
  blokTandaTangan,
  gayaKepala,
  isi,
  logoPasanganKanan,
  logoTengah,
} from "@/lib/export/xlsx-gaya";
import { formatTanggal } from "@/lib/format";

/**
 * Export laporan periodik ke .xlsx (exceljs, server-side — BUKAN AG Grid export).
 *
 * Empat sheet, mengikuti berkas resmi KKP (permintaan user 2026-08-06 —
 * DECISIONS 265), urut seperti dokumen cetaknya:
 *
 *  1. "COV-BQ"  — halaman sampul laporan progres.
 *  2. "REKAP"   — rekapitulasi bobot per kelompok pekerjaan + progres & deviasi.
 *                 Kolom rupiah SENGAJA tidak ada: pada berkas KKP kolom Nilai
 *                 HPS/Penawaran/Negosiasi di sheet REKAP semuanya di-hidden,
 *                 jadi yang berlaku memang murni bobot.
 *  3. "Kurva S" — tabel bobot kategori × minggu + baris prestasi + grafik kurva-S.
 *  4. "Laporan" — rincian item per kategori (setara sheet "RAB" berkas KKP).
 *
 * Format angka #,##0.00 agar konsisten di Excel Indonesia. Angka ditulis sebagai
 * ANGKA + numFmt, tidak pernah sebagai teks yang sudah diformat — supaya tetap
 * bisa dijumlah pemeriksa dan mengikuti locale pembukanya.
 */

const NUM_FMT = FMT_ANGKA;

// Lebar kolom tabel rincian — header blanko KKP (3 baris, berkelompok):
// No | Uraian | Volume Kontrak | Satuan | Harga Satuan | Harga Total | Bobot |
// Realisasi Pekerjaan { Lalu / Ini / S-d × Volume, Prestasi, Bobot } |
// Bobot Rencana | Sisa Pekerjaan { Prestasi, Volume }.
//
// "Harga Satuan" & "Harga Total" ditambahkan 2026-08-06 (kolom yang memang
// TERLIHAT pada sheet RAB berkas KKP; kolom HPS/penawaran/negosiasi di sana
// disembunyikan, jadi tidak ikut dibuat). Struktur kolom lama TIDAK diubah —
// hanya bergeser ke kanan dua kolom.
const COL_WIDTHS = [5, 48, 12, 8, 14, 17, 9, 11, 9, 9, 11, 9, 9, 11, 9, 9, 11, 9, 11] as const;
const COL_COUNT = COL_WIDTHS.length; // 19

/** Indeks kolom sheet "Laporan" — satu tempat, supaya rumus & merge tidak meleset. */
const KOL = {
  no: 1,
  uraian: 2,
  volK: 3,
  satuan: 4,
  hargaSatuan: 5,
  hargaTotal: 6,
  bobot: 7,
  realisasi: 8, // blok 8..16
  volLalu: 8,
  prestasiLalu: 9,
  bobotLalu: 10,
  volIni: 11,
  prestasiIni: 12,
  bobotIni: 13,
  volSd: 14,
  prestasiSd: 15,
  bobotSd: 16,
  bobotRencana: 17,
  sisaPrestasi: 18,
  sisaVol: 19,
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Sheet-1 "Kurva S": tabel bobot kategori × minggu (increment) + baris prestasi
 * (rencana/realisasi kumulatif + deviasi) + GAMBAR grafik kurva-S. Angka identik
 * dgn tabel KKP & kurva PDF (satu sumber, buildKurvaSheet).
 */
type KurvaSheetResult = {
  chart: LineChartSpec;
  /**
   * Tautkan sel "Realisasi Prestasi %" minggu `week` (1-based) ke rumus Excel
   * (mis. total "Bobot Minggu ini" di sheet Laporan) — angka minggu aktif
   * TERTAUT ke rinciannya, bukan tempelan statis. Diabaikan bila minggu di luar
   * rentang ber-realisasi (menjaga kolom kosong tetap kosong, B7).
   */
  linkRealisasi: (week: number, formula: string) => void;
};

async function addKurvaSheet(
  wb: ExcelJS.Workbook,
  r: PeriodReport,
  /**
   * `jenis` WAJIB: lembar kurva-S yang sama dipakai dua dokumen berbeda —
   * sebagai bagian laporan periodik (ikut jenis laporannya) dan sebagai Time
   * Schedule berdiri sendiri (dokumen jadwal). DECISIONS 403.
   */
  opts: { jenis: JenisDokumen; sheetName?: string; logo?: LogoLaporan },
): Promise<KurvaSheetResult> {
  const sheet = buildKurvaSheet({
    categories: r.kurvaSchedule,
    totalWeeks: r.totalWeeks,
    contractStart: r.header.contractStart,
    actualCum: r.scurve.actualPct,
    currentWeek: r.scurve.currentWeek,
    planCumOfficial: r.scurve.planPct,
  });
  const N = sheet.totalWeeks;
  const FIRST = 4; // A=No, B=Uraian, C=Bobot, D.. = minggu
  const lastCol = 3 + N;
  // KETERANGAN di kanan: 2 kolom sempit batang skala checkerboard (0–100%) + 1 kolom label.
  const scaleA = lastCol + 1;
  const scaleB = lastCol + 2;
  const ketLabel = lastCol + 3;
  const lastTableCol = ketLabel;
  const ws = wb.addWorksheet(opts?.sheetName ?? "Kurva S", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { width: 5 },
    { width: 40 },
    { width: 9 },
    ...Array.from({ length: N }, () => ({ width: 6 })),
    { width: 2.6 },
    { width: 2.6 },
    { width: 6 },
  ];

  const box = KOTAK;

  const banner = (text: string, bold: boolean, size: number, warna: string = WARNA.teks) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, lastTableCol);
    row.getCell(1).font = { bold, size, color: { argb: warna } };
    row.getCell(1).alignment = { horizontal: "center" };
    return row;
  };
  const barisJudul = banner(
    `KURVA S – ${r.kind === "mingguan" ? `MINGGU KE-${r.n}` : `BULAN KE-${r.n}`}`,
    true,
    12,
    WARNA.kepala,
  );
  banner(`${r.header.packageName} – ${r.header.village}, ${r.header.regency}`, false, 10, WARNA.teksRedup);
  // Tata letak berkas acuan (Time Schedule): identitas di kiri, PASANGAN logo
  // pemilik + kontraktor BERJAJAR DI KANAN — bukan kiri-kanan terpisah.
  ws.getRow(barisJudul.number + 1).height = 34;
  logoPasanganKanan(wb, ws, opts?.logo, {
    rowAtas: barisJudul.number,
    tinggiPx: 44,
    kolomKiri: 1,
    kolomKanan: lastTableCol,
  });
  ws.addRow([]);

  // Header 2 baris: kelompok bulan (merge) + minggu.
  const monthRow = ws.addRow([]);
  monthRow.getCell(1).value = "No";
  monthRow.getCell(2).value = "Uraian Pekerjaan";
  monthRow.getCell(3).value = "Bobot (%)";
  let c = FIRST;
  for (const g of sheet.monthGroups) {
    monthRow.getCell(c).value = g.label;
    if (g.span > 1) ws.mergeCells(monthRow.number, c, monthRow.number, c + g.span - 1);
    c += g.span;
  }
  const weekRow = ws.addRow([]);
  for (let i = 0; i < N; i++) weekRow.getCell(FIRST + i).value = `M${i + 1}`;
  ws.mergeCells(monthRow.number, 1, weekRow.number, 1);
  ws.mergeCells(monthRow.number, 2, weekRow.number, 2);
  ws.mergeCells(monthRow.number, 3, weekRow.number, 3);
  monthRow.getCell(scaleA).value = "KETERANGAN";
  ws.mergeCells(monthRow.number, scaleA, weekRow.number, ketLabel); // header KET 2 baris × 3 kolom
  for (const row of [monthRow, weekRow]) {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > lastTableCol) return;
      gayaKepala(cell, { sub: row === weekRow, size: 8 });
    });
  }

  // Baris kategori (bobot + increment mingguan).
  const catRowNums: number[] = [];
  const weekFirstL = colLetter(FIRST);
  const weekLastL = colLetter(lastCol);
  for (const cat of sheet.categories) {
    const row = ws.addRow([cat.code, cat.name, null, ...cat.weeklyShown.map((v) => (v > 0 ? v : null))]);
    // Kolom "Bobot (%)" = RUMUS Σ sebaran mingguan barisnya, bukan angka
    // tempelan: bobot kategori bisa ditelusuri ke minggu pembentuknya, dan
    // mengubah sel minggu di Excel langsung memperbarui bobotnya. Nilai cache =
    // bobot resmi kategori — `weeklyShown` sudah dialokasikan supaya Σ-nya
    // persis segitu (kkp-sheet.ts).
    row.getCell(3).value = {
      formula: `SUM(${weekFirstL}${row.number}:${weekLastL}${row.number})`,
      result: cat.bobotShown,
    };
    catRowNums.push(row.number);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > lastCol) return;
      cell.border = box;
      cell.font = { size: 8, bold: col === 2 };
      if (col === 1) cell.alignment = { horizontal: "center" };
      else if (col === 3) { cell.alignment = { horizontal: "center" }; cell.numFmt = "#,##0.00"; }
      else if (col >= FIRST) { cell.alignment = { horizontal: "right" }; cell.numFmt = "#,##0.000"; }
    });
  }

  // Baris prestasi (kumulatif rencana/realisasi + deviasi). RUMUS, bukan angka
  // statis, supaya edit tabel kategori/realisasi otomatis menjalar ke kumulatif → grafik.
  const colL = (i: number) => colLetter(FIRST + i); // kolom minggu ke-i (0-based): D, E, …
  // Minggu terakhir yang punya realisasi resmi — kolom sesudahnya SENGAJA
  // kosong, sama dengan layar & PDF (audit 2026-07-27, B7: Excel dulu menulis
  // kumulatif carry-forward + deviasi negatif besar untuk minggu depan yang di
  // layar kosong — satu dokumen, dua cerita).
  const cutoffIdx = (() => {
    let last = -1;
    for (let i = 0; i < N; i++) if (sheet.kumulatifRealisasi[i] != null) last = i;
    return last;
  })();
  // Baris rencana kembali memakai RUMUS Σ kolom kategori (keputusan user
  // 2026-07-27, DECISIONS 158 — membatalkan pengunciannya di B3): rencana harus
  // bisa ditelusuri ke jadwal pembentuknya dan ikut hidup saat jadwal diedit.
  // Nilai cache diambil dari sel kategori yang BENAR-BENAR ditulis, bukan dari
  // kurva resmi, supaya angka simpan tidak pernah berbeda dari hasil hitung Excel.
  const firstCatN = catRowNums[0];
  const lastCatN = catRowNums[catRowNums.length - 1];
  const rencanaMatrix = Array.from({ length: N }, (_, i) =>
    round2(sheet.categories.reduce((s, c) => s + c.weeklyShown[i], 0)),
  );
  const kumRencanaMatrix: number[] = [];
  {
    let acc = 0;
    for (const v of rencanaMatrix) {
      acc += v;
      kumRencanaMatrix.push(round2(acc));
    }
  }
  let rencanaRow = 0;
  let kumRencanaRow = 0;
  let realisasiRow = 0;
  let kumRealisasiRow = 0;
  type Kind = "rencana" | "kumRencana" | "realisasi" | "kumRealisasi" | "deviasi";
  const prestasi: { label: string; arr: (number | null)[]; bold: boolean; kind: Kind }[] = [
    { label: "Rencana Prestasi %", arr: sheet.rencanaPerWeek, bold: false, kind: "rencana" },
    { label: "Kumulatif Rencana Prestasi %", arr: sheet.kumulatifRencana, bold: true, kind: "kumRencana" },
    { label: "Realisasi Prestasi %", arr: sheet.realisasiPerWeek, bold: false, kind: "realisasi" },
    { label: "Kumulatif Realisasi Prestasi %", arr: sheet.kumulatifRealisasi, bold: true, kind: "kumRealisasi" },
    { label: "Deviasi +/-", arr: sheet.deviasi, bold: true, kind: "deviasi" },
  ];
  for (const def of prestasi) {
    const row = ws.addRow([]);
    if (def.kind === "rencana") rencanaRow = row.number;
    else if (def.kind === "kumRencana") kumRencanaRow = row.number;
    else if (def.kind === "realisasi") realisasiRow = row.number;
    else if (def.kind === "kumRealisasi") kumRealisasiRow = row.number;
    const latar = def.bold ? WARNA.total : WARNA.subtotal;
    row.getCell(1).value = def.label;
    ws.mergeCells(row.number, 1, row.number, 2); // label A:B — kolom C tetap kolom bobot
    row.getCell(1).alignment = { horizontal: "right" };
    row.getCell(1).font = { size: 8, bold: def.bold };
    row.getCell(1).border = box;
    row.getCell(1).fill = isi(latar);
    row.getCell(2).fill = isi(latar);
    // Total kolom bobot (baris kumulatif rencana) = RUMUS Σ bobot kategori,
    // sejajar dengan tampilan layar/PDF. Ikut hidup bila baris kategori diedit.
    const totalCell = row.getCell(3);
    if (def.kind === "kumRencana" && catRowNums.length > 0) {
      totalCell.value = {
        formula: `SUM(C${catRowNums[0]}:C${catRowNums[catRowNums.length - 1]})`,
        result: sheet.totalBobotShown,
      };
      totalCell.numFmt = "#,##0.00";
    }
    totalCell.alignment = { horizontal: "center" };
    totalCell.font = { size: 8, bold: def.bold };
    totalCell.border = box;
    totalCell.fill = isi(latar);
    for (let i = 0; i < N; i++) {
      const cell = row.getCell(FIRST + i);
      const val = def.arr[i] == null ? null : round2(def.arr[i] as number);
      if (def.kind === "rencana") {
        // Σ increment kategori pada minggu ini.
        cell.value = firstCatN
          ? { formula: `SUM(${colL(i)}${firstCatN}:${colL(i)}${lastCatN})`, result: rencanaMatrix[i] }
          : val;
      } else if (def.kind === "kumRencana") {
        // Kumulatif: minggu-1 = rencana; berikutnya = kumulatif sebelumnya + rencana.
        cell.value = firstCatN
          ? {
              formula:
                i === 0 ? `${colL(0)}${rencanaRow}` : `${colL(i - 1)}${kumRencanaRow}+${colL(i)}${rencanaRow}`,
              result: kumRencanaMatrix[i],
            }
          : val;
      } else if (def.kind === "kumRealisasi") {
        // Rumus kumulatif hidup HANYA s/d minggu ber-realisasi; sesudahnya
        // kosong seperti layar/PDF (B7).
        if (i <= cutoffIdx) {
          const f = i === 0 ? `${colL(0)}${realisasiRow}` : `${colL(i - 1)}${kumRealisasiRow}+${colL(i)}${realisasiRow}`;
          cell.value = { formula: f, result: val ?? 0 };
        } else {
          cell.value = null;
        }
      } else if (def.kind === "deviasi") {
        if (i <= cutoffIdx) {
          cell.value = {
            formula: `${colL(i)}${kumRealisasiRow}-${colL(i)}${kumRencanaRow}`,
            result: round2((sheet.kumulatifRealisasi[i] ?? 0) - sheet.kumulatifRencana[i]),
          };
        } else {
          cell.value = null;
        }
      } else {
        // Realisasi per-minggu = nilai aktual dari aplikasi (sumber; bisa diedit manual).
        cell.value = val;
      }
      cell.numFmt = "#,##0.00";
      cell.alignment = { horizontal: "right" };
      // Deviasi diberi warna semantik: satu-satunya baris yang punya arti
      // baik/buruk. Baris lain tetap netral supaya warnanya tidak jadi hiasan.
      const warnaTeks =
        def.kind === "deviasi" && typeof val === "number" && val !== 0
          ? val < 0
            ? WARNA.negatif
            : WARNA.positif
          : WARNA.teks;
      cell.font = { size: 8, bold: def.bold, color: { argb: warnaTeks } };
      cell.border = box;
      cell.fill = isi(latar);
    }
    for (const kc of [scaleA, scaleB, ketLabel]) row.getCell(kc).border = box; // KET berpetak
  }

  // KETERANGAN = BATANG SKALA 0–100% kotak-kotak HITAM-PUTIH (checkerboard) sejajar
  // rentang vertikal kurva (baris kategori), + label 100/75/50/25/0 di kanan batang.
  const M = catRowNums.length;
  if (M > 0) {
    const fillC = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
    const BLACK = WARNA.kepala; // batang skala memakai navy identitas, bukan hitam pekat
    const WHITE = "FFFFFFFF";
    catRowNums.forEach((rowN, i) => {
      const row = ws.getRow(rowN);
      row.getCell(scaleA).fill = fillC(i % 2 === 0 ? BLACK : WHITE);
      row.getCell(scaleB).fill = fillC(i % 2 === 0 ? WHITE : BLACK);
      for (const kc of [scaleA, scaleB, ketLabel]) row.getCell(kc).border = box;
    });
    const marks: [number, number, "top" | "middle" | "bottom"][] = [
      [100, catRowNums[0], "top"],
      [0, catRowNums[M - 1], "bottom"],
    ];
    if (M >= 3) marks.push([50, catRowNums[Math.round((M - 1) / 2)], "middle"]);
    if (M >= 6) {
      marks.push([75, catRowNums[Math.round((M - 1) * 0.25)], "middle"]);
      marks.push([25, catRowNums[Math.round((M - 1) * 0.75)], "middle"]);
    }
    for (const [val, rowN, vAlign] of marks) {
      const cell = ws.getRow(rowN).getCell(ketLabel);
      cell.value = val;
      cell.numFmt = '0"%"';
      cell.font = { size: 8, bold: true, color: { argb: "FF0F172A" } };
      cell.alignment = { horizontal: "right", vertical: vAlign };
    }
  }

  // Data helper (baris TERSEMBUNYI) utk chart scatter: titik origin (X=0, Y=0%) +
  // kumulatif per akhir-minggu (X=1..N). Scatter dipilih (bukan line/kategori) supaya
  // kurva MULAI dari 0% di kiri-bawah & X menembus tepi kolom minggu (w/N). `plotVisOnly=0`
  // di chartXml → baris tersembunyi ini tetap diplot.
  const helperX = ws.addRow([0, ...Array.from({ length: N }, (_, i) => i + 1)]);
  // Sumber Y grafik = RUMUS tertaut ke baris kumulatif yang terlihat (bukan angka
  // statis). Jadi begitu tabel diedit di Excel, grafik ikut ter-update. Sel A tetap
  // 0 (titik origin agar kurva mulai dari 0%).
  const helperY = ws.addRow([]);
  helperY.getCell(1).value = 0;
  for (let i = 0; i < N; i++) {
    // Cache mengikuti sel yang dirujuk (baris kumulatif rencana), bukan kurva resmi.
    helperY.getCell(2 + i).value = { formula: `${colL(i)}${kumRencanaRow}`, result: kumRencanaMatrix[i] };
  }
  const helperR = ws.addRow([]);
  helperR.getCell(1).value = 0;
  for (let i = 0; i < N; i++) {
    // Sumber realisasi grafik mengikuti baris "Kumulatif Realisasi" — yang kini
    // berhenti di minggu ber-realisasi terakhir (B7). Garis realisasi di grafik
    // pun berhenti di titik yang sama dengan layar/PDF.
    if (i <= cutoffIdx) {
      helperR.getCell(2 + i).value = {
        formula: `${colL(i)}${kumRealisasiRow}`,
        result: round2(sheet.kumulatifRealisasi[i] ?? 0),
      };
    } else {
      helperR.getCell(2 + i).value = null;
    }
  }
  for (const hr of [helperX, helperY, helperR]) hr.hidden = true;
  const lastHelperCol = colLetter(N + 1); // A..(N+1) = origin + N minggu
  const hRange = (rowN: number) => `'${ws.name}'!$A$${rowN}:$${lastHelperCol}$${rowN}`;

  // Anchor OVERLAY transparan TEPAT di atas blok kolom minggu (kolom D..lastCol) ×
  // baris kategori (firstCatRow..lastCatRow) → kurva-S menelusuri kolom minggu.
  const firstCatRow = weekRow.number + 1;
  const lastCatRow = firstCatRow + sheet.categories.length - 1;
  const chart: LineChartSpec = {
    sheetName: ws.name,
    xMax: N,
    series: [
      { name: "Rencana", xRef: hRange(helperX.number), yRef: hRange(helperY.number), color: "2563EB" },
      { name: "Realisasi", xRef: hRange(helperX.number), yRef: hRange(helperR.number), color: "16A34A" },
    ],
    anchor: { fromCol: FIRST - 1, fromRow: firstCatRow - 1, toCol: lastCol, toRow: lastCatRow },
  };

  // Blok tanda tangan (permintaan user 2026-08-06): kurva-S ikut ditandatangani
  // seperti blanko KKP. Diletakkan di bawah baris helper tersembunyi supaya
  // tidak mengganggu rentang data grafik.
  blokTandaTangan(ws, { lastCol: lastTableCol, h: r.header, jenis: opts.jenis });

  return {
    chart,
    linkRealisasi: (week, formula) => {
      if (week < 1 || week > N || week - 1 > cutoffIdx) return;
      const cell = ws.getRow(realisasiRow).getCell(FIRST + week - 1);
      const cur = cell.value;
      cell.value = { formula, result: typeof cur === "number" ? cur : 0 };
    },
  };
}

/* ── Sheet "COV-BQ": halaman sampul ───────────────────────────────────────── */

/**
 * Nama lokasi + wilayahnya. Nama desa yang SAMA dengan nama lokasi tidak
 * diulang — banyak lokasi KNMP dinamai persis desanya, dan "Pasar Banggi —
 * Pasar Banggi, Rembang" terbaca seperti salah tempel, bukan seperti alamat.
 */
const lokasiLengkap = (h: PeriodReport["header"]): string => {
  const wilayah = [
    h.village.trim() === h.locationName.trim() ? null : h.village,
    h.district ? `Kec. ${h.district}` : null,
    h.regency,
    h.province,
  ].filter(Boolean);
  return `${h.locationName} – ${wilayah.join(", ")}`;
};

const labelPeriode = (r: PeriodReport): string =>
  r.kind === "mingguan" ? `MINGGU KE-${r.n}` : `BULAN KE-${r.n}`;

/**
 * Halaman sampul laporan progres — setara sheet "COV-BQ" berkas KKP.
 *
 * Sengaja BUKAN tabel: sampul dibaca sekali sebelum dokumen dibuka, jadi
 * bentuknya blok terpusat (judul → identitas berpasangan label/isi → pelaksana),
 * sama seperti sampul laporan konsultan. Tidak ada angka progres di sini — angka
 * ada di REKAP; sampul yang ikut menyebut angka jadi tempat kedua yang bisa
 * basi tanpa ketahuan.
 */
function addCoverSheet(wb: ExcelJS.Workbook, r: PeriodReport, logo?: LogoLaporan): void {
  const h = r.header;
  const LAST = 8;
  const ws = wb.addWorksheet("COV-BQ", {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
  });
  ws.columns = [{ width: 4 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 4 }];

  const baris = (
    teks: string | null,
    gaya: { size?: number; bold?: boolean; color?: string; tinggi?: number; pita?: boolean } = {},
  ) => {
    const row = ws.addRow([]);
    const cell = row.getCell(2);
    cell.value = teks;
    cell.font = {
      size: gaya.size ?? 10,
      bold: gaya.bold ?? false,
      color: { argb: gaya.color ?? WARNA.teks },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    ws.mergeCells(row.number, 2, row.number, LAST - 1);
    if (gaya.tinggi) row.height = gaya.tinggi;
    if (gaya.pita) for (let c = 1; c <= LAST; c++) row.getCell(c).fill = isi(WARNA.kategori);
    return row;
  };

  /** Label kecil di atas isinya — bentuk sampul, bukan tabel. */
  const pasangan = (label: string, isiTeks: string, besar = 12) => {
    baris(label, { size: 9, bold: true, color: WARNA.teksRedup });
    baris(isiTeks, { size: besar, bold: true, tinggi: besar > 11 ? 20 : 16 });
    ws.addRow([]);
  };

  const kosong = (n: number) => {
    for (let i = 0; i < n; i++) ws.addRow([]);
  };

  // ── LOGO PEMILIK PEKERJAAN: DI PUNCAK, DI TENGAH ──
  // Tata letaknya diambil dari berkas acuan, bukan dikarang (koreksi user
  // 2026-08-06: "SIAPA YANG MENYURUHMU TARUH DI ATAS KANAN DAN KIRI. DI CONTOH
  // SUDAH ADA SEMUA TATA LETAKNYA").
  kosong(1);
  const pitaPemilik = ws.addRow([]);
  pitaPemilik.height = 96; // > tinggi logo (118 px ≈ 89 pt)
  logoTengah(wb, ws, logo?.pemilik ?? null, {
    rowAtas: pitaPemilik.number,
    tinggiPx: 118,
    kolomKiri: 2,
    kolomKanan: LAST - 1,
  });
  kosong(1);

  // ── Pita judul ──
  baris(`LAPORAN PROGRES ${labelPeriode(r)}`, {
    size: 16,
    bold: true,
    color: WARNA.kepala,
    tinggi: 26,
    pita: true,
  });
  kosong(3);

  // ── Identitas ──
  pasangan("SATUAN KERJA", h.ownerAgency.toUpperCase(), 12);
  kosong(1);
  baris(h.packageName.toUpperCase(), { size: 13, bold: true, tinggi: 22 });
  kosong(2);
  baris(
    `PERIODE ${formatTanggal(h.periodeStart, "d MMMM yyyy").toUpperCase()} S/D ${formatTanggal(h.periodeEnd, "d MMMM yyyy").toUpperCase()}`,
    { size: 10, bold: true },
  );
  baris(`TAHUN ${h.tahunAnggaran}`, { size: 10, bold: true });
  kosong(3);

  baris("LOKASI PEKERJAAN", { size: 9, bold: true, color: WARNA.teksRedup });
  baris(lokasiLengkap(h).toUpperCase(), { size: 11, bold: true, tinggi: 18 });
  kosong(1);

  // ── LOGO KONTRAKTOR: DI TENGAH, TEPAT DI ATAS KETERANGANNYA ──
  const pitaKontraktor = ws.addRow([]);
  pitaKontraktor.height = 66; // > tinggi logo (74 px ≈ 55 pt) supaya keterangannya tidak tertutup
  logoTengah(wb, ws, logo?.kontraktor ?? null, {
    rowAtas: pitaKontraktor.number,
    tinggiPx: 74,
    kolomKiri: 2,
    kolomKanan: LAST - 1,
  });
  baris("KONTRAKTOR PELAKSANA", { size: 10, bold: true });
  // Nama perusahaan TETAP ditulis: kalau logonya belum diunggah, sampul tanpa
  // baris ini tidak menyebut pelaksananya sama sekali.
  baris(h.vendorName, { size: 12, bold: true, color: WARNA.kepala, tinggi: 18 });
  baris(`Nomor Kontrak: ${h.contractNumber}`, { size: 9, color: WARNA.teksRedup });
}

/* ── Sheet "REKAP": rekapitulasi bobot per kelompok pekerjaan ─────────────── */

/**
 * Rekapitulasi — setara sheet "REKAP" berkas KKP.
 *
 * MURNI BOBOT, tanpa kolom rupiah. Bukan penyederhanaan: pada berkas resmi
 * kolom Nilai HPS / Penawaran / Negosiasi dan baris JUMLAH–PPN–TOTAL di sheet
 * itu semuanya di-hidden, jadi yang benar-benar berlaku memang hanya bobot
 * (permintaan user 2026-08-06: "hanya fokus pada bagian yang tidak dihidden").
 * Rincian rupiah tetap ada, tempatnya di sheet "Laporan".
 */
function addRekapSheet(wb: ExcelJS.Workbook, r: PeriodReport, logo?: LogoLaporan): void {
  const h = r.header;
  const LAST = 6;
  const periodeLabel = r.kind === "mingguan" ? "Minggu" : "Bulan";
  const ws = wb.addWorksheet("REKAP", {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 5 }, { width: 46 }, { width: 14 }, { width: 15 }, { width: 15 }, { width: 16 }];

  const judul = (teks: string, size: number, warna: string) => {
    const row = ws.addRow([teks]);
    ws.mergeCells(row.number, 1, row.number, LAST);
    row.getCell(1).font = { bold: true, size, color: { argb: warna } };
    row.getCell(1).alignment = { horizontal: "center" };
  };
  judul(`REKAPITULASI LAPORAN ${r.kind === "mingguan" ? "MINGGUAN" : "BULANAN"}`, 14, WARNA.kepala);
  judul(labelPeriode(r), 11, WARNA.kepalaSub);
  ws.addRow([]);

  // Identitas: label (A:B) + ":" + isi (C:D). Kolom E–F SENGAJA dibiarkan kosong
  // — di situlah PASANGAN LOGO berjajar, persis tata letak berkas acuan
  // (koreksi user 2026-08-06). Nilai identitas tidak boleh melebar ke sana.
  const kv = (k: string, v: string) => {
    const row = ws.addRow([]);
    row.getCell(1).value = k.toUpperCase();
    row.getCell(1).font = { bold: true, size: 9, color: { argb: WARNA.kepala } };
    row.getCell(1).alignment = { vertical: "middle" };
    ws.mergeCells(row.number, 1, row.number, 2);
    const cell = row.getCell(3);
    cell.value = `:  ${v}`;
    cell.font = { size: 9, color: { argb: WARNA.teks } };
    const baris = Math.max(1, Math.ceil(v.length / 42));
    cell.alignment = { vertical: "middle", wrapText: baris > 1 };
    ws.mergeCells(row.number, 3, row.number, 4);
    row.height = baris > 1 ? baris * 12.5 : 15;
    return row;
  };
  const barisIdentitasPertama = kv("Kegiatan", h.packageName).number;
  kv("Tahun Anggaran", String(h.tahunAnggaran));
  kv("Pemberi Tugas", h.ownerAgency);
  kv("Kontraktor", h.vendorName);
  kv("Konsultan Pengawas", h.supervisorFirm?.trim() || h.supervisorName?.trim() || "–");
  kv("Alamat", lokasiLengkap(h));
  kv(`${periodeLabel} ke`, `${r.n} dari ${r.maxN}`);
  kv(
    "Periode",
    `${formatTanggal(h.periodeStart, "d MMMM yyyy")} s/d ${formatTanggal(h.periodeEnd, "d MMMM yyyy")}`,
  );
  // PASANGAN logo berjajar di KANAN blok identitas — pemilik lalu kontraktor.
  logoPasanganKanan(wb, ws, logo, {
    rowAtas: barisIdentitasPertama,
    tinggiPx: 62,
    kolomKiri: 5,
    kolomKanan: LAST,
  });
  ws.addRow([]);

  // Kepala tabel.
  const head = ws.addRow([
    "NO",
    "JENIS PEKERJAAN",
    "BOBOT PEKERJAAN (%)",
    `BOBOT ${periodeLabel.toUpperCase()} LALU (%)`,
    `BOBOT ${periodeLabel.toUpperCase()} INI (%)`,
    "BOBOT KOMULATIF (%)",
  ]);
  head.height = 32;
  for (let c = 1; c <= LAST; c++) gayaKepala(head.getCell(c), { size: 9 });

  const gayaBaris = (row: ExcelJS.Row, opts?: { bold?: boolean; fill?: string }) => {
    for (let c = 1; c <= LAST; c++) {
      const cell = row.getCell(c);
      cell.border = KOTAK;
      cell.font = { size: 9, bold: opts?.bold ?? false, color: { argb: WARNA.teks } };
      if (opts?.fill) cell.fill = isi(opts.fill);
      if (c === 1) cell.alignment = { horizontal: "center" };
      if (c >= 3) {
        cell.alignment = { horizontal: "right" };
        cell.numFmt = FMT_ANGKA;
      }
    }
  };

  const rowNums: number[] = [];
  r.categories.forEach((c, i) => {
    const row = ws.addRow([
      c.code || String(i + 1),
      c.name,
      c.subtotalBobot,
      c.subtotalBobotLalu,
      c.subtotalBobotIni,
      null,
    ]);
    // Bobot komulatif = lalu + ini. RUMUS, bukan angka tempelan: tiga kolom di
    // satu baris tidak boleh bisa saling berselisih di tangan pembaca.
    row.getCell(6).value = {
      formula: `D${row.number}+E${row.number}`,
      result: round2(c.subtotalBobotSd),
    };
    rowNums.push(row.number);
    gayaBaris(row);
  });

  const totalRow = ws.addRow([null, "TOTAL"]);
  for (const c of [3, 4, 5, 6]) {
    const L = colLetter(c);
    const nilai =
      c === 3
        ? r.categories.reduce((s, k) => s + k.subtotalBobot, 0)
        : c === 4
          ? r.totals.bobotLalu
          : c === 5
            ? r.totals.bobotIni
            : r.totals.bobotSd;
    totalRow.getCell(c).value =
      rowNums.length > 0
        ? { formula: `SUM(${L}${rowNums[0]}:${L}${rowNums[rowNums.length - 1]})`, result: round2(nilai) }
        : round2(nilai);
  }
  gayaBaris(totalRow, { bold: true, fill: WARNA.total });
  ws.addRow([]);

  // Blok progres & deviasi. Realisasi TERTAUT ke baris TOTAL tabel di atas;
  // rencana datang dari kurva-S resmi (baseline) — sumbernya memang bukan tabel
  // ini, jadi ditulis sebagai angka dengan keterangan asalnya di bawah.
  const rencanaIni = round2(r.planPct - r.planPrevPct);
  const blok = (label: string, isiNilai: number | ExcelJS.CellFormulaValue, tebal = false) => {
    const row = ws.addRow([]);
    row.getCell(1).value = label;
    row.getCell(1).font = { size: 9, bold: tebal, color: { argb: WARNA.teks } };
    ws.mergeCells(row.number, 1, row.number, 4);
    const cell = row.getCell(5);
    cell.value = isiNilai;
    cell.numFmt = FMT_PERSEN;
    cell.alignment = { horizontal: "right" };
    cell.font = { size: 9, bold: tebal, color: { argb: WARNA.teks } };
    ws.mergeCells(row.number, 5, row.number, LAST);
    for (let c = 1; c <= LAST; c++) {
      row.getCell(c).border = KOTAK;
      if (tebal) row.getCell(c).fill = isi(WARNA.total);
      else row.getCell(c).fill = isi(WARNA.subtotal);
    }
    return row;
  };
  blok(`PROGRES RENCANA ${periodeLabel.toUpperCase()} INI`, rencanaIni);
  const rowRencanaKum = blok("AKUMULASI PROGRES RENCANA", round2(r.planPct));
  blok(`REALISASI PROGRES ${periodeLabel.toUpperCase()} INI`, {
    formula: `E${totalRow.number}`,
    result: round2(r.totals.bobotIni),
  });
  const rowRealKum = blok("AKUMULASI REALISASI PROGRES", {
    formula: `F${totalRow.number}`,
    result: round2(r.totals.bobotSd),
  });
  const rowDev = blok(
    "DEVIASI",
    { formula: `E${rowRealKum.number}-E${rowRencanaKum.number}`, result: round2(r.deviationPct) },
    true,
  );
  // Deviasi diberi warna & keterangan — angka negatif tanpa kata "terlambat"
  // rutin dibaca sebagai "kurang sedikit" oleh pembaca non-teknis.
  const dev = r.deviationPct;
  const ket = dev < -0.005 ? "TERLAMBAT" : dev > 0.005 ? "LEBIH CEPAT" : "SESUAI RENCANA";
  const warnaDev = dev < -0.005 ? WARNA.negatif : dev > 0.005 ? WARNA.positif : WARNA.teks;
  rowDev.getCell(5).font = { size: 9, bold: true, color: { argb: warnaDev } };
  rowDev.getCell(1).value = `DEVIASI – ${ket}`;
  rowDev.getCell(1).font = { size: 9, bold: true, color: { argb: warnaDev } };

  const catatan = ws.addRow([
    'Progres rencana bersumber dari baseline kurva-S aktif (sheet "Kurva S"); realisasi bersumber dari rincian item (sheet "Laporan").',
  ]);
  ws.mergeCells(catatan.number, 1, catatan.number, LAST);
  catatan.getCell(1).font = { size: 8, italic: true, color: { argb: WARNA.teksRedup } };
  catatan.getCell(1).alignment = { wrapText: true, vertical: "top" };
  catatan.height = 24;

  blokTandaTangan(ws, { lastCol: LAST, h, jenis: r.kind });
}

/**
 * Time Schedule (Kurva-S) berdiri sendiri sebagai .xlsx — satu sheet tabel
 * kategori × minggu (bobot) + kumulatif rencana/realisasi + GRAFIK NATIVE Excel.
 * Format menyerupai time schedule sipil (contoh TS vendor).
 */
export async function buildJadwalXlsx(r: PeriodReport, opts?: { logo?: LogoLaporan }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.created = new Date();
  const { chart } = await addKurvaSheet(wb, r, { jenis: "jadwal", sheetName: "Time Schedule", logo: opts?.logo });
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  try {
    return await addLineChartToXlsx(buf, chart);
  } catch {
    return buf;
  }
}

export async function buildPeriodReportXlsx(
  r: PeriodReport,
  opts?: { logo?: LogoLaporan },
): Promise<Buffer> {
  const logo = opts?.logo;
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.created = new Date();
  // Urutan sheet mengikuti dokumen cetak KKP: sampul → rekap → kurva-S → rincian.
  addCoverSheet(wb, r, logo);
  addRekapSheet(wb, r, logo);
  // Sheet "Kurva S" di dalam workbook LAPORAN adalah bagian laporannya,
  // bukan dokumen jadwal (DECISIONS 403).
  const kurva = await addKurvaSheet(wb, r, { jenis: r.kind, logo });
  const ws = wb.addWorksheet("Laporan", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = COL_WIDTHS.map((w) => ({ width: w }));
  const periodeLabel = r.kind === "mingguan" ? "Minggu" : "Bulan";

  const judul = r.kind === "mingguan" ? "LAPORAN MINGGUAN PEKERJAAN" : "LAPORAN BULANAN PEKERJAAN";
  const ke = r.kind === "mingguan" ? `Minggu Ke-${r.n}` : `Bulan Ke-${r.n}`;
  const h = r.header;

  const title = (text: string, bold = true, size = 12, warna: string = WARNA.kepala) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, COL_COUNT);
    row.getCell(1).font = { bold, size, color: { argb: warna } };
    row.getCell(1).alignment = { horizontal: "center" };
  };
  // Sheet rincian (setara "RAB" berkas acuan) SENGAJA tanpa logo — di berkas
  // resmi pun hanya sampul, rekap, dan time schedule yang berkop.
  title(judul);
  title(ke, true, 11);
  title(
    `Periode ${formatTanggal(h.periodeStart, "d MMMM yyyy")} s/d ${formatTanggal(h.periodeEnd, "d MMMM yyyy")}`,
    false,
    10,
    WARNA.teksRedup,
  );
  ws.addRow([]);

  // Blok identitas: label (merge A:B) + nilai (merge C..kolom terakhir tabel).
  // Sel gabungan TIDAK melimpah ke kolom tetangga dan tidak ikut auto-tinggi,
  // jadi nilai panjang (nama paket KKP bisa >80 karakter) dulu terpotong di
  // tengah kalimat. Sekarang lebarnya seluruh tabel; kalau masih lebih panjang,
  // teks dibungkus dan tinggi baris ditambah sesuai jumlah barisnya.
  const VALUE_LAST = COL_COUNT;
  const VALUE_WIDTH = COL_WIDTHS.slice(2, VALUE_LAST).reduce((s, w) => s + w, 0);
  const kv = (k: string, v: string | number, numFmt?: string) => {
    const row = ws.addRow([]);
    const label = row.getCell(1);
    label.value = k;
    label.font = { bold: true, size: 9, color: { argb: WARNA.kepala } };
    label.alignment = { horizontal: "left", vertical: "middle" };
    ws.mergeCells(row.number, 1, row.number, 2);
    const value = row.getCell(3);
    value.value = v;
    value.font = { size: 9, color: { argb: WARNA.teks } };
    if (numFmt) value.numFmt = numFmt;
    ws.mergeCells(row.number, 3, row.number, VALUE_LAST);
    const lines = Math.max(1, Math.ceil(String(v).length / Math.max(10, VALUE_WIDTH - 2)));
    value.alignment = { horizontal: "left", vertical: "middle", wrapText: lines > 1 };
    row.height = lines > 1 ? lines * 13.5 : 15;
    return { cell: value, row: row.number };
  };
  kv("Paket Pekerjaan", h.packageName);
  kv("Lokasi", `${h.locationName} – ${h.village}, ${h.regency}, ${h.province}`);
  kv("Nomor Kontrak", h.contractNumber);
  kv("Kontraktor Pelaksana", h.vendorName);
  kv("Nilai Fisik Lokasi", `Rp ${new Intl.NumberFormat("id-ID").format(Number(h.locationValue))}`);
  kv("Masa Pelaksanaan", `${h.masaPelaksanaanHari} Hari Kalender`);
  kv("Tahun Anggaran", String(h.tahunAnggaran));
  // Tiga angka ringkasan ini DITAUTKAN ke baris JUMLAH tabel di bawah setelah
  // tabelnya terbentuk (nomor barisnya belum diketahui di sini).
  const sumRencana = kv("Rencana s/d periode (%)", round2(r.planPct), "0.00");
  const sumRealisasi = kv("Realisasi s/d periode (%)", round2(r.actualPct), "0.00");
  const sumDeviasi = kv("Deviasi (%)", round2(r.deviationPct), "0.00");
  ws.addRow([]);

  // Header tabel — 3 baris berkelompok, mengikuti blanko KKP.
  const h1 = ws.addRow([]);
  const h2 = ws.addRow([]);
  const h3 = ws.addRow([]);
  const setHead = (row: ExcelJS.Row, col: number, text: string) => {
    row.getCell(col).value = text;
  };
  setHead(h1, KOL.no, "No");
  setHead(h1, KOL.uraian, "Uraian Pekerjaan");
  setHead(h1, KOL.volK, "Volume Kontrak");
  setHead(h1, KOL.satuan, "Satuan");
  setHead(h1, KOL.hargaSatuan, "Harga Satuan (Rp)");
  setHead(h1, KOL.hargaTotal, "Harga Total (Rp)");
  setHead(h1, KOL.bobot, "Bobot");
  setHead(h1, KOL.realisasi, "Realisasi Pekerjaan");
  setHead(h1, KOL.bobotRencana, "Bobot Rencana");
  setHead(h1, KOL.sisaPrestasi, "Sisa Pekerjaan");
  setHead(h2, KOL.volLalu, `${periodeLabel} Lalu`);
  setHead(h2, KOL.volIni, `${periodeLabel} ini`);
  setHead(h2, KOL.volSd, `S/d ${periodeLabel} ini`);
  setHead(h2, KOL.sisaPrestasi, `S/d ${periodeLabel} ini`);
  for (const base of [KOL.volLalu, KOL.volIni, KOL.volSd]) {
    setHead(h3, base, "Volume");
    setHead(h3, base + 1, "Prestasi");
    setHead(h3, base + 2, "Bobot");
  }
  setHead(h3, KOL.sisaPrestasi, "Prestasi");
  setHead(h3, KOL.sisaVol, "Volume");
  for (const col of [KOL.no, KOL.uraian, KOL.volK, KOL.satuan, KOL.hargaSatuan, KOL.hargaTotal, KOL.bobot, KOL.bobotRencana]) {
    ws.mergeCells(h1.number, col, h3.number, col);
  }
  ws.mergeCells(h1.number, KOL.realisasi, h1.number, KOL.bobotSd); // "Realisasi Pekerjaan"
  ws.mergeCells(h1.number, KOL.sisaPrestasi, h1.number, KOL.sisaVol); // "Sisa Pekerjaan"
  ws.mergeCells(h2.number, KOL.volLalu, h2.number, KOL.bobotLalu);
  ws.mergeCells(h2.number, KOL.volIni, h2.number, KOL.bobotIni);
  ws.mergeCells(h2.number, KOL.volSd, h2.number, KOL.bobotSd);
  ws.mergeCells(h2.number, KOL.sisaPrestasi, h2.number, KOL.sisaVol);
  for (const row of [h1, h2, h3]) {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > COL_COUNT) return;
      gayaKepala(cell, { sub: row !== h1, size: 9 });
    });
  }

  const numericCols: number[] = [
    KOL.volK,
    KOL.hargaSatuan,
    KOL.hargaTotal,
    KOL.bobot,
    KOL.volLalu,
    KOL.prestasiLalu,
    KOL.bobotLalu,
    KOL.volIni,
    KOL.prestasiIni,
    KOL.bobotIni,
    KOL.volSd,
    KOL.prestasiSd,
    KOL.bobotSd,
    KOL.bobotRencana,
    KOL.sisaPrestasi,
    KOL.sisaVol,
  ];
  /** Kolom rupiah: bulat, tanpa desimal — nilai kontrak selalu rupiah penuh. */
  const rupiahCols: number[] = [KOL.hargaSatuan, KOL.hargaTotal];
  // Menyusuri kolom 1..COL_COUNT secara eksplisit, BUKAN `eachCell` — eachCell
  // berhenti di sel terakhir yang punya nilai, sehingga baris judul kategori
  // (hanya 2 sel terisi) dulu kehilangan garis & latar di sisa kolomnya.
  const styleDataRow = (row: ExcelJS.Row, opts?: { bold?: boolean; fill?: string }) => {
    for (let col = 1; col <= COL_COUNT; col++) {
      const cell = row.getCell(col);
      cell.border = KOTAK_HALUS;
      if (opts?.bold) cell.font = { bold: true, size: 9, color: { argb: WARNA.teks } };
      else cell.font = { size: 9, color: { argb: WARNA.teks } };
      if (opts?.fill) cell.fill = isi(opts.fill);
      if (numericCols.includes(col)) {
        cell.alignment = { horizontal: "right" };
        cell.numFmt = rupiahCols.includes(col) ? FMT_RUPIAH : NUM_FMT;
      }
      if (col === KOL.satuan) cell.alignment = { horizontal: "center" };
    }
  };

  // Kolom yang MENJUMLAH: Harga Total (F), Bobot (G), Bobot Lalu (J), Bobot Ini
  // (M), Bobot S/d (P), Bobot Rencana (Q). Subtotal kategori = rumus SUM atas
  // baris item; JUMLAH = penjumlahan sel subtotal — angka agregat TERTAUT ke
  // rincian (kebiasaan pemeriksa KKP menelusuri link), nilai cache = angka resmi.
  //
  // "Harga Total" ikut menjumlah supaya JUMLAH-nya = nilai fisik lokasi di kop —
  // pemeriksa bisa mencocokkan angka kontrak dengan rincian tanpa kalkulator.
  type Cat = (typeof r.categories)[number];
  const SUM_COLS = [
    { col: KOL.hargaTotal, sub: (c: Cat) => c.subtotalAmount, total: () => r.categories.reduce((s, c) => s + c.subtotalAmount, 0) },
    { col: KOL.bobot, sub: (c: Cat) => c.subtotalBobot, total: () => r.categories.reduce((s, c) => s + c.subtotalBobot, 0) },
    { col: KOL.bobotLalu, sub: (c: Cat) => c.subtotalBobotLalu, total: () => r.totals.bobotLalu },
    { col: KOL.bobotIni, sub: (c: Cat) => c.subtotalBobotIni, total: () => r.totals.bobotIni },
    { col: KOL.bobotSd, sub: (c: Cat) => c.subtotalBobotSd, total: () => r.totals.bobotSd },
    { col: KOL.bobotRencana, sub: (c: Cat) => c.subtotalBobotRencana, total: () => r.totals.bobotRencana },
  ] as const;
  const subRowNums: number[] = [];

  for (const cat of r.categories) {
    const catRow = ws.addRow([cat.code, cat.name]);
    let firstItemRow = 0;
    let lastItemRow = 0;
    for (const it of cat.rows) {
      const row = ws.addRow([
        it.no,
        it.name,
        it.volK,
        it.unit,
        it.unitPrice,
        null, // Harga Total = rumus volume × harga satuan (di bawah)
        it.bobot,
        it.volLalu,
        it.prestasiLalu,
        it.bobotLalu,
        it.volIni,
        it.prestasiIni,
        it.bobotIni,
        it.volSd,
        it.prestasiSd,
        it.bobotSd,
        it.bobotRencana,
      ]);
      const rn = row.number;
      // Harga Total = Volume Kontrak × Harga Satuan — rumus, supaya pemeriksa
      // bisa menelusuri (dan mengedit harga satuan) tanpa angka jadi bohong.
      // Cache = `amount` RAB aktif, sumber resmi bobotnya.
      row.getCell(KOL.hargaTotal).value = {
        formula: `${colLetter(KOL.volK)}${rn}*${colLetter(KOL.hargaSatuan)}${rn}`,
        result: it.amount,
      };
      // Kolom "Sisa Pekerjaan" = PERHITUNGAN, bukan angka tempelan — persis
      // formula kanonik (periodic-report §sisa): sisa prestasi = 100 − prestasi
      // s/d, sisa volume = volume kontrak − volume s/d, keduanya dibatasi ≥ 0.
      row.getCell(KOL.sisaPrestasi).value = {
        formula: `MAX(0,100-${colLetter(KOL.prestasiSd)}${rn})`,
        result: round2(it.sisaPrestasi),
      };
      row.getCell(KOL.sisaVol).value = {
        formula: `MAX(0,${colLetter(KOL.volK)}${rn}-${colLetter(KOL.volSd)}${rn})`,
        result: it.sisaVol,
      };
      if (!firstItemRow) firstItemRow = row.number;
      lastItemRow = row.number;
      styleDataRow(row);
    }
    const subRow = ws.addRow([null, `Subtotal ${cat.name}`]);
    for (const { col, sub } of SUM_COLS) {
      const L = colLetter(col);
      subRow.getCell(col).value = firstItemRow
        ? { formula: `SUM(${L}${firstItemRow}:${L}${lastItemRow})`, result: sub(cat) }
        : sub(cat);
      // Bobot di baris JUDUL kategori mengikuti sel subtotalnya — satu angka,
      // satu sumber; dulu ditulis dua kali dan bisa berbeda diam-diam.
      catRow.getCell(col).value = { formula: `${L}${subRow.number}`, result: sub(cat) };
    }
    subRowNums.push(subRow.number);
    // Gaya dipasang SETELAH semua nilai terisi — supaya kolom yang baru diisi
    // lewat SUM_COLS ikut ber-format angka, bukan tampil polos.
    styleDataRow(catRow, { bold: true, fill: WARNA.kategori });
    styleDataRow(subRow, { bold: true, fill: WARNA.subtotal });
  }

  const totalRow = ws.addRow([null, "JUMLAH"]);
  for (const { col, total } of SUM_COLS) {
    const L = colLetter(col);
    totalRow.getCell(col).value =
      subRowNums.length > 0
        ? { formula: subRowNums.map((n2) => `${L}${n2}`).join("+"), result: total() }
        : total();
  }
  styleDataRow(totalRow, { bold: true, fill: WARNA.total });

  // Ringkasan di kepala dokumen TERTAUT ke JUMLAH tabel — bukan angka tempelan:
  // Rencana = JUMLAH kolom "Bobot Rencana", Realisasi = JUMLAH kolom "Bobot S/d"
  // (`actualPct` memang didefinisikan = Σ bobot s/d, periodic-report.ts), dan
  // Deviasi = Realisasi − Rencana (formula kanonik progress.ts). Jadi pemeriksa
  // bisa klik dari angka ringkasan sampai ke baris item pembentuknya.
  const valueCol = colLetter(3);
  sumRencana.cell.value = {
    formula: `${colLetter(KOL.bobotRencana)}${totalRow.number}`,
    result: round2(r.planPct),
  };
  sumRealisasi.cell.value = {
    formula: `${colLetter(KOL.bobotSd)}${totalRow.number}`,
    result: round2(r.actualPct),
  };
  sumDeviasi.cell.value = {
    formula: `${valueCol}${sumRealisasi.row}-${valueCol}${sumRencana.row}`,
    result: round2(r.deviationPct),
  };

  // Baris "Realisasi Prestasi %" minggu laporan di sheet Kurva S TERTAUT ke
  // total "Bobot Minggu ini" (JUMLAH kolom K) di sheet ini — bukan angka
  // tempelan. Rumus kumulatif & grafik sudah membaca baris itu, jadi tautan
  // menjalar sampai kurva. Hanya utk laporan mingguan (bulanan mencakup >1
  // kolom minggu — tak bisa dipetakan ke satu sel).
  if (r.kind === "mingguan") {
    kurva.linkRealisasi(r.n, `Laporan!${colLetter(KOL.bobotIni)}${totalRow.number}`);
  }

  // Ringkasan sumber daya + kendala.
  ws.addRow([]);
  const section = (text: string) => {
    const row = ws.addRow([text]);
    row.getCell(1).font = { bold: true, size: 10, color: { argb: WARNA.kepala } };
    ws.mergeCells(row.number, 1, row.number, 8);
  };
  section("Tenaga Kerja (orang-hari, agregat periode)");
  for (const t of r.tenaga) kv(t.label, t.count);
  section("Material Masuk (agregat periode)");
  for (const m of r.material) kv(m.name, `${m.qty}${m.unit ? ` ${m.unit}` : ""}`);
  section("Peralatan (unit-hari, agregat periode)");
  for (const a of r.alat) kv(a.name, a.count);
  section("Cuaca");
  kv("Ringkasan", r.cuacaRingkas);
  section("Kendala");
  if (r.kendala.length === 0) {
    kv("–", "Tidak ada kendala tercatat pada periode ini");
  } else {
    for (const k of r.kendala) kv(formatTanggal(k.createdAt), `${k.title} (${k.severity}, ${k.status})`);
  }

  blokTandaTangan(ws, { lastCol: COL_COUNT, h, jenis: r.kind });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  // Sisipkan grafik kurva-S NATIVE ke sheet "Kurva S" (exceljs tak bisa; kita
  // pasca-proses XML chart OOXML). Bila gagal, kembalikan workbook tanpa chart.
  try {
    return await addLineChartToXlsx(buf, kurva.chart);
  } catch {
    return buf;
  }
}
