import "server-only";
import ExcelJS from "exceljs";
import { barisRencanaRealisasi, type KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { WORKER_ROLE_LABEL, WORKER_ROLE_ORDER } from "@/lib/daily-report/constants";
import { KKP_WEATHER_HOURS } from "@/lib/weather/hourly";

/**
 * LAPORAN HARIAN KKP → .xlsx, MENGIKUTI BLANKO YANG SAMA dengan versi cetak
 * (`components/knmp/kkp-daily-report.tsx`), blok demi blok dengan urutan sama:
 *
 *   kop (LAPORAN HARIAN | KONSULTAN PENGAWAS | KONTRAKTOR PELAKSANA)
 *   → Minggu Ke / Hari / Tanggal → PEMBERI KERJA / PEKERJAAN / LOKASI /
 *     TH. ANGGARAN
 *   → TENAGA KERJA | REKAP PEMASUKAN BAHAN / MATERIAL (+ PERALATAN)
 *   → KONDISI CUACA per jam (+ SHOP DRAWING) → Jam Kerja
 *   → RENCANA PEKERJAAN | REALISASI PEKERJAAN → catatan → tanda tangan.
 *
 * Laporan user 2026-08-03: *"format excel laporan harianmu belum menyesuaikan
 * format pdf terakhir"*. Versi sebelumnya masih bentuk lama — tanpa kop
 * pengawas/pelaksana, tanpa baris PEKERJAAN, tanpa cuaca per jam, tanpa rencana
 * vs realisasi, tanpa pengelompokan bangunan, tanpa tanda tangan; identitas
 * pemiliknya bahkan masih "Kampung Nelayan Merah Putih (KNMP)" yang ditanam di
 * kode, padahal sejak DECISIONS 166 identitas itu datang dari menu Sistem.
 *
 * BARISNYA DIPINJAM, BUKAN DISUSUN ULANG. `barisRencanaRealisasi()` diimpor
 * dari modul cetak, jadi penomoran, judul bangunan, dan teks realisasi tidak
 * bisa lagi menyimpang antara PDF dan Excel — dan menyusunnya dua kali persis
 * yang membuatnya menyimpang selama ini. DECISIONS 241.
 *
 * Satu blok TAMBAHAN di luar blanko — rincian kemajuan per pekerjaan dalam
 * kolom angka — diletakkan PALING BAWAH supaya susunan blanko tidak bergeser.
 * Blok itu justru alasan orang meminta Excel alih-alih PDF: bisa disortir dan
 * dijumlah sendiri.
 */

const NUM2 = "#,##0.00";
const NUM3 = "#,##0.000";
const NUM0 = "#,##0";

/** Baris kosong tercetak — blanko punya kotak siap-isi walau datanya belum ada. */
const MIN_MATERIAL_ROWS = 8;
const MIN_EQUIPMENT_ROWS = 6;

const JAM = KKP_WEATHER_HOURS;
/** 19 kolom: A no · B uraian · C–Q lima belas kolom jam · R–S shop drawing. */
const KOL_AKHIR = 19;

const thin = { style: "thin" as const };
const GARIS: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const ABU: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF2F7" } };

type OpsiSel = {
  gabung?: number;
  gabungBaris?: number;
  tebal?: boolean;
  kepala?: boolean;
  rata?: "left" | "center" | "right";
  fmt?: string;
  bungkus?: boolean;
  ukuran?: number;
};

export async function buildDailyReportXlsx(d: KkpDailyData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  const ws = wb.addWorksheet("Laporan Harian", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });

  // Kolom jam WAJIB sempit dan seragam supaya grid cuaca terbaca seperti blanko;
  // kolom teks dibentuk dengan MERGE, bukan dengan melebarkan kolomnya.
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 26;
  for (let c = 3; c <= 17; c++) ws.getColumn(c).width = 5;
  ws.getColumn(18).width = 9;
  ws.getColumn(19).width = 9;

  const sel = (r: number, c: number, nilai: ExcelJS.CellValue, o: OpsiSel = {}) => {
    const cell = ws.getCell(r, c);
    cell.value = nilai;
    if (o.gabung && o.gabung > c) ws.mergeCells(r, c, o.gabungBaris ?? r, o.gabung);
    else if (o.gabungBaris && o.gabungBaris > r) ws.mergeCells(r, c, o.gabungBaris, c);
    cell.font = { size: o.ukuran ?? 9, bold: o.tebal || o.kepala };
    cell.alignment = { horizontal: o.rata ?? "left", vertical: "middle", wrapText: o.bungkus };
    cell.border = GARIS;
    if (o.kepala) cell.fill = ABU;
    if (o.fmt) cell.numFmt = o.fmt;
    return cell;
  };
  /** Garis untuk sel yang tidak ditulis, supaya kotak blanko tidak bolong. */
  const garisBaris = (r: number, dari = 1, sampai = KOL_AKHIR) => {
    for (let c = dari; c <= sampai; c++) {
      const cell = ws.getRow(r).getCell(c);
      if (!cell.border) cell.border = GARIS;
    }
  };

  let r = 1;

  // ── Kop ────────────────────────────────────────────────────────────────────
  sel(r, 1, "LAPORAN HARIAN", { gabung: 6, tebal: true, rata: "center", ukuran: 13 });
  sel(r, 7, "KONSULTAN PENGAWAS", { gabung: 12, kepala: true, rata: "center" });
  sel(r, 13, "KONTRAKTOR PELAKSANA", { gabung: KOL_AKHIR, kepala: true, rata: "center" });
  ws.getRow(r).height = 20;
  r += 1;

  // Nama perusahaan membentang tiga baris — kotak "logo perusahaan" di blanko.
  sel(r, 7, d.supervisorFirm ?? "", { gabung: 12, gabungBaris: r + 2, rata: "center", bungkus: true });
  sel(r, 13, d.contractorFirm ?? "", { gabung: KOL_AKHIR, gabungBaris: r + 2, rata: "center", bungkus: true });
  const kopKiri: [string, string][] = [
    ["Minggu Ke", d.weekNo != null ? String(d.weekNo) : ""],
    ["Hari", d.hari],
    ["Tanggal", d.tanggalFull],
  ];
  kopKiri.forEach(([label, nilai], i) => {
    const br = r + i;
    sel(br, 1, label, { gabung: 2 });
    sel(br, 3, ":", { rata: "center" });
    sel(br, 4, nilai, { gabung: 6 });
    garisBaris(br);
  });
  r += kopKiri.length;

  const kopBawah: [string, string][] = [
    // Identitas pemberi kerja dari menu Sistem, BUKAN dipatok KKP (DECISIONS 166).
    ["PEMBERI KERJA", [d.ownerName, d.ownerSubtitle].filter(Boolean).join(" – ") || "-"],
    ["PEKERJAAN", d.pekerjaan ?? "Konstruksi"],
    ["LOKASI", `${d.locationName}, ${d.regency}, ${d.province}`],
    ["TH. ANGGARAN", String(d.tahunAnggaran)],
  ];
  for (const [label, nilai] of kopBawah) {
    sel(r, 1, label, { gabung: 2 });
    sel(r, 3, ":", { rata: "center" });
    sel(r, 4, nilai, { gabung: KOL_AKHIR, bungkus: true });
    r += 1;
  }
  if (!d.isFinal) {
    const c = sel(r, 1, "PRATINJAU – laporan belum difinalisasi; angka masih bisa berubah.", {
      gabung: KOL_AKHIR,
      rata: "center",
    });
    c.font = { size: 9, bold: true, color: { argb: "FF92400E" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    r += 1;
  }
  r += 1;

  // ── Tenaga kerja (kiri) | material (kanan) ─────────────────────────────────
  sel(r, 1, "TENAGA KERJA", { gabung: 6, kepala: true, rata: "center" });
  sel(r, 8, "REKAP PEMASUKAN BAHAN / MATERIAL", { gabung: KOL_AKHIR, kepala: true, rata: "center" });
  r += 1;
  sel(r, 1, "No", { kepala: true, rata: "center" });
  sel(r, 2, "Keahlian", { kepala: true, rata: "center" });
  sel(r, 3, "Jmh", { gabung: 4, kepala: true, rata: "center" });
  sel(r, 5, "Sat", { gabung: 6, kepala: true, rata: "center" });
  sel(r, 8, "No", { kepala: true, rata: "center" });
  sel(r, 9, "Jenis Material / Bahan", { gabung: 13, kepala: true, rata: "center" });
  sel(r, 14, "Satuan", { gabung: 15, kepala: true, rata: "center" });
  sel(r, 16, "Diterima", { gabung: 17, kepala: true, rata: "center" });
  // "Ditolak" ada di blanko tetapi belum ada inputnya di sistem — dikosongkan
  // untuk diisi tangan, bukan dihilangkan.
  sel(r, 18, "Ditolak", { gabung: KOL_AKHIR, kepala: true, rata: "center" });
  r += 1;

  // SELURUH keahlian ditulis termasuk yang nol: blanko memang mendaftar semua,
  // dan baris yang hilang terbaca "keahlian ini tidak dipakai di proyek".
  WORKER_ROLE_ORDER.forEach((wr, i) => {
    const br = r + i;
    sel(br, 1, i + 1, { rata: "center" });
    sel(br, 2, WORKER_ROLE_LABEL[wr]);
    sel(br, 3, d.workerMap[wr] ?? 0, { gabung: 4, rata: "right", fmt: NUM2 });
    sel(br, 5, "org", { gabung: 6, rata: "center" });
  });
  const brJumlah = r + WORKER_ROLE_ORDER.length;
  sel(brJumlah, 1, "Jumlah", { gabung: 2, tebal: true, rata: "center" });
  sel(brJumlah, 3, d.totalWorkers, { gabung: 4, tebal: true, rata: "right", fmt: NUM2 });
  sel(brJumlah, 5, "org", { gabung: 6, rata: "center" });

  const barisKanan = Math.max(MIN_MATERIAL_ROWS, d.materials.length);
  for (let i = 0; i < barisKanan; i++) {
    const br = r + i;
    const m = d.materials[i];
    sel(br, 8, i + 1, { rata: "center" });
    sel(br, 9, m?.name ?? "", { gabung: 13 });
    sel(br, 14, m?.unit ?? "", { gabung: 15, rata: "center" });
    sel(br, 16, m && m.qty != null ? m.qty : "", { gabung: 17, rata: "right", fmt: NUM3 });
    sel(br, 18, "", { gabung: KOL_AKHIR });
  }
  const tinggiBlok = Math.max(WORKER_ROLE_ORDER.length + 1, barisKanan);
  for (let i = 0; i < tinggiBlok; i++) garisBaris(r + i);
  r += tinggiBlok;

  // Peralatan — di blanko menempel di bawah material (separuh kanan).
  sel(r, 8, "PERALATAN", { gabung: KOL_AKHIR, kepala: true, rata: "center" });
  garisBaris(r);
  r += 1;
  sel(r, 8, "No", { kepala: true, rata: "center" });
  sel(r, 9, "Nama Peralatan", { gabung: 15, kepala: true, rata: "center" });
  sel(r, 16, "Jumlah", { gabung: KOL_AKHIR, kepala: true, rata: "center" });
  garisBaris(r);
  r += 1;
  const barisAlat = Math.max(MIN_EQUIPMENT_ROWS, d.equipment.length);
  for (let i = 0; i < barisAlat; i++) {
    const e = d.equipment[i];
    sel(r + i, 8, i + 1, { rata: "center" });
    sel(r + i, 9, e?.name ?? "", { gabung: 15 });
    sel(r + i, 16, e ? e.count : "", { gabung: KOL_AKHIR, rata: "center", fmt: NUM0 });
    garisBaris(r + i);
  }
  r += barisAlat + 1;

  // ── Kondisi cuaca per jam ──────────────────────────────────────────────────
  sel(r, 1, "KONDISI CUACA", { gabung: 17, kepala: true, rata: "center" });
  // Shop drawing ada di blanko, datanya belum ada di sistem — dikosongkan.
  sel(r, 18, "Shop Drawing", { gabung: KOL_AKHIR, kepala: true, rata: "center" });
  r += 1;
  sel(r, 1, "Kondisi / Jam", { gabung: 2, kepala: true, rata: "center" });
  JAM.forEach((h, i) => sel(r, 3 + i, `${String(h).padStart(2, "0")}.00`, { kepala: true, rata: "center" }));
  sel(r, 18, "", { gabung: KOL_AKHIR, kepala: true });
  r += 1;
  for (const kategori of ["Cerah", "Mendung", "Hujan"] as const) {
    sel(r, 1, kategori, { gabung: 2 });
    // Kondisi PER JAM bila cuaca diambil otomatis dari koordinat lokasi; tanpa
    // data per jam, jatuh ke perilaku lama (satu kategori sehari penuh).
    JAM.forEach((h, i) =>
      sel(r, 3 + i, (d.weatherByHour ? d.weatherByHour[h] === kategori : d.activeWeather === kategori) ? "✓" : "", {
        rata: "center",
      }),
    );
    sel(r, 18, "", { gabung: KOL_AKHIR });
    r += 1;
  }

  // ── Jam kerja ──────────────────────────────────────────────────────────────
  sel(r, 1, "Jam Kerja", { gabung: 2, tebal: true });
  sel(r, 3, `mulai ${d.workStart ?? "……"} – selesai ${d.workEnd ?? "……"}`, { gabung: KOL_AKHIR });
  r += 2;

  // ── Rencana | realisasi ────────────────────────────────────────────────────
  sel(r, 1, "RENCANA PEKERJAAN", { gabung: 9, kepala: true, rata: "center" });
  sel(r, 10, "REALISASI PEKERJAAN", { gabung: KOL_AKHIR, kepala: true, rata: "center" });
  r += 1;
  for (const baris of barisRencanaRealisasi(d)) {
    sel(r, 1, baris.rencanaNo, { rata: "center" });
    sel(r, 2, baris.rencana ?? "", { gabung: 9, bungkus: true });
    sel(r, 10, baris.realisasiKategori ? "" : baris.realisasiNo, { rata: "center" });
    sel(r, 11, baris.realisasi ?? "", { gabung: KOL_AKHIR, bungkus: true, tebal: baris.realisasiKategori });
    r += 1;
  }

  // Baris basis draft adendum TIDAK dicetak di blanko, tapi keberadaannya
  // disebut — kalau tidak, pekerjaan yang dilaporkan mandor seolah hilang tanpa
  // jejak dan orang mengira sistemnya kehilangan data. DECISIONS 215.
  if ((d.draftItemCount ?? 0) > 0) {
    const c = sel(
      r,
      1,
      `${d.draftItemCount} pekerjaan hari ini dilaporkan atas usulan adendum yang belum disetujui sehingga ` +
        `tidak dicetak di blanko ini – belum ada dasar kontraknya. Rinciannya ada di pantauan internal MARLIN.`,
      { gabung: KOL_AKHIR, bungkus: true },
    );
    c.font = { size: 8, italic: true, color: { argb: "FF6B7280" } };
    r += 1;
  }
  r += 1;

  // ── Catatan ────────────────────────────────────────────────────────────────
  sel(r, 1, "CATATAN / KETERANGAN", { gabung: KOL_AKHIR, kepala: true });
  r += 1;
  sel(r, 1, d.notes || " ", { gabung: KOL_AKHIR, bungkus: true });
  ws.getRow(r).height = 32;
  r += 2;

  // ── Tanda tangan ───────────────────────────────────────────────────────────
  const rTtd = r;
  const ttd: { c1: number; c2: number; atas: string; peran: string; firma: string; nama: string | null; jabatan: string }[] = [
    {
      c1: 1,
      c2: 9,
      atas: "Disetujui Oleh;",
      peran: "Konsultan Pengawas",
      firma: d.supervisorFirm ?? d.supervisorSub ?? "",
      nama: d.supervisorName ?? null,
      jabatan: "Inspector",
    },
    {
      c1: 10,
      c2: KOL_AKHIR,
      atas: "Dibuat Oleh :",
      peran: "Kontraktor Pelaksana",
      firma: d.contractorFirm ?? "",
      nama: d.contractorName ?? null,
      jabatan: d.contractorSub || "Pelaksana",
    },
  ];
  for (const t of ttd) {
    sel(rTtd, t.c1, t.atas, { gabung: t.c2, rata: "center" });
    sel(rTtd + 1, t.c1, t.peran, { gabung: t.c2, rata: "center" });
    sel(rTtd + 2, t.c1, t.firma, { gabung: t.c2, rata: "center" });
    sel(rTtd + 5, t.c1, t.nama ? `( ${t.nama} )` : "( …………………… )", { gabung: t.c2, tebal: true, rata: "center" });
    sel(rTtd + 6, t.c1, t.jabatan, { gabung: t.c2, rata: "center" });
  }
  for (let i = 0; i <= 6; i++) garisBaris(rTtd + i);
  ws.getRow(rTtd + 3).height = 22;
  ws.getRow(rTtd + 4).height = 22;
  r = rTtd + 8;

  // ── TAMBAHAN di luar blanko: rincian kemajuan per pekerjaan ────────────────
  sel(r, 1, "RINCIAN KEMAJUAN PEKERJAAN (tambahan MARLIN – tidak ada di blanko KKP)", {
    gabung: KOL_AKHIR,
    kepala: true,
  });
  r += 1;
  const kolom: [string, number, number][] = [
    ["No", 1, 1],
    ["Bangunan / Kategori", 2, 5],
    ["Uraian Pekerjaan", 6, 10],
    ["Sat.", 11, 11],
    ["Vol Kontrak", 12, 13],
    ["Vol s/d Lalu", 14, 15],
    ["Vol Hari Ini", 16, 16],
    ["Vol s/d Ini", 17, 17],
    ["% s/d Ini", 18, KOL_AKHIR],
  ];
  for (const [judul, c1, c2] of kolom) sel(r, c1, judul, { gabung: c2, kepala: true, rata: "center", bungkus: true });
  r += 1;
  if (d.items.length === 0) {
    sel(r, 1, "Tidak ada progres pekerjaan pada hari ini.", { gabung: KOL_AKHIR });
  } else {
    d.items.forEach((it, i) => {
      sel(r, 1, i + 1, { rata: "center" });
      // Kategori ditulis apa adanya; null = tidak ada lagi di RAB aktif, tidak ditebak.
      sel(r, 2, it.categoryName ? `${it.categoryCode ? `${it.categoryCode}. ` : ""}${it.categoryName}` : "–", {
        gabung: 5,
        bungkus: true,
      });
      sel(r, 6, `${it.code ? `${it.code}  ` : ""}${it.name}`, { gabung: 10, bungkus: true });
      sel(r, 11, it.unit ?? "", { rata: "center" });
      sel(r, 12, it.volumeContract, { gabung: 13, rata: "right", fmt: NUM3 });
      sel(r, 14, it.volumeBefore, { gabung: 15, rata: "right", fmt: NUM3 });
      sel(r, 16, it.volumeToday, { rata: "right", fmt: NUM3 });
      sel(r, 17, it.volumeCumulative, { rata: "right", fmt: NUM3 });
      sel(r, 18, it.pctCumulative, { gabung: KOL_AKHIR, rata: "right", fmt: NUM2 });
      r += 1;
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
