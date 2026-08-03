import "server-only";
import ExcelJS from "exceljs";
import { susunBarisCco, bobotPersen, type CcoNode, type CcoRow } from "@/lib/rab/cco-rows";

/**
 * DOKUMEN CCO (Contract Change Order) — format yang diminta KKP untuk pengajuan
 * adendum (permintaan user 2026-08-03, berkas contoh sheet "CCO-01 (BANGUNAN)").
 *
 * Empat blok angka berdampingan per item:
 *
 *   MC - 0            : keadaan kontrak yang BERLAKU (revisi RAB aktif)
 *   PEKERJAAN TAMBAH  : kenaikan per item
 *   PEKERJAAN KURANG  : penurunan per item
 *   CCO - 01          : keadaan SETELAH adendum (draft revisi)
 *
 * TATA LETAK DIRAPIKAN, TIDAK MENYALIN POSISI BARIS/KOLOM BERKAS CONTOH.
 *
 * Versi pertama menyalin posisinya mentah-mentah — judul di baris 13, tabel
 * mulai baris 27, kolom G dan H dibiarkan kosong, header empat tingkat dengan
 * kata terpenggal ("HARGA"/"SATUAN"/"Rp.") — dengan alasan "supaya pemeriksa
 * membaca dokumen yang sama bentuknya". Hasilnya dinilai user berantakan dan
 * banyak ruang terbuang, dan itu benar: 12 baris kosong di atas judul serta dua
 * kolom kosong di tengah tabel bukan bagian dari format, itu sisa kertas kerja
 * di berkas contoh (kolomnya memang kosong di SELURUH baris data).
 *
 * Yang ditiru sekarang STRUKTURNYA — urutan blok, isi kolom, dan penamaan —
 * bukan koordinat selnya. 17 kolom rapat A–Q tanpa kolom kosong, header dua
 * tingkat, tabel mulai baris 10.
 *
 * Blok kanan berkas contoh (CCO-PRC / CCO-PERENCANA / BIAYA PELAKSANAAN) tetap
 * tidak disalin — keputusan user *"b-v saja"*; itu kertas kerja konsultan dan
 * isinya `#REF!`. Begitu pula baris PROGRAM/KEGIATAN/PAGU/SUMBER DANA —
 * *"dihide, abaikan saja dulu"*.
 */

const RUPIAH_FMT = "#,##0";
const VOL_FMT = "#,##0.000";
const PCT_FMT = "0.00";

const GARIS: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

/** Kode DB bisa membawa suffix dedup internal (`VI#2`) — artefak, jangan tampil. */
const displayCode = (code: string) => code.replace(/#\d+$/, "").trim();
const displayName = (name: string) => name.replace(/\s+/g, " ").trim();

export type CcoXlsxInput = {
  locationName: string;
  packageName: string;
  workTitle: string | null;
  address: string | null;
  contractNumber: string | null;
  vendorName: string | null;
  /** Dari `Contract.ppnPercent` — JANGAN dipatok 11. */
  ppnPercent: number;
  ccoNo: number;
  lama: CcoNode[];
  baru: CcoNode[];
};

// ── Peta kolom ────────────────────────────────────────────────────────────────
// Satu-satunya sumber lebar, perataan, dan format angka. Menambah kolom cukup
// di sini; header, baris data, dan kaki semuanya ikut.
type Rata = "left" | "center" | "right";
type Kolom = { key: string; judul: string; lebar: number; rata: Rata; fmt?: string };

const KOL_NO: Kolom = { key: "no", judul: "NO", lebar: 7, rata: "center" };
const KOL_URAIAN: Kolom = { key: "uraian", judul: "URAIAN PEKERJAAN", lebar: 52, rata: "left" };
const KOL_KET: Kolom = { key: "ket", judul: "KET", lebar: 11, rata: "center" };

const BLOK: { judul: string; kolom: Kolom[] }[] = [
  {
    judul: "MC - 0",
    kolom: [
      { key: "volumeLama", judul: "VOLUME", lebar: 11, rata: "right", fmt: VOL_FMT },
      { key: "satuan", judul: "SATUAN", lebar: 9, rata: "center" },
      { key: "hargaLama", judul: "HARGA SATUAN (Rp)", lebar: 16, rata: "right", fmt: RUPIAH_FMT },
      { key: "jumlahLama", judul: "JUMLAH HARGA (Rp)", lebar: 18, rata: "right", fmt: RUPIAH_FMT },
      { key: "bobotLama", judul: "BOBOT (%)", lebar: 9, rata: "right", fmt: PCT_FMT },
    ],
  },
  {
    judul: "PEKERJAAN TAMBAH",
    kolom: [
      { key: "volumeTambah", judul: "VOLUME", lebar: 11, rata: "right", fmt: VOL_FMT },
      { key: "jumlahTambah", judul: "JUMLAH HARGA (Rp)", lebar: 18, rata: "right", fmt: RUPIAH_FMT },
      { key: "bobotTambah", judul: "BOBOT (%)", lebar: 9, rata: "right", fmt: PCT_FMT },
    ],
  },
  {
    judul: "PEKERJAAN KURANG",
    kolom: [
      { key: "volumeKurang", judul: "VOLUME", lebar: 11, rata: "right", fmt: VOL_FMT },
      { key: "jumlahKurang", judul: "JUMLAH HARGA (Rp)", lebar: 18, rata: "right", fmt: RUPIAH_FMT },
      { key: "bobotKurang", judul: "BOBOT (%)", lebar: 9, rata: "right", fmt: PCT_FMT },
    ],
  },
  {
    judul: "CCO - 01",
    kolom: [
      { key: "volumeBaru", judul: "VOLUME", lebar: 11, rata: "right", fmt: VOL_FMT },
      { key: "jumlahBaru", judul: "JUMLAH HARGA (Rp)", lebar: 18, rata: "right", fmt: RUPIAH_FMT },
      { key: "bobotBaru", judul: "BOBOT (%)", lebar: 9, rata: "right", fmt: PCT_FMT },
    ],
  },
];

const KOLOM: Kolom[] = [KOL_NO, KOL_URAIAN, ...BLOK.flatMap((b) => b.kolom), KOL_KET];
const idx = (key: string) => KOLOM.findIndex((k) => k.key === key) + 1; // 1-based ExcelJS
const TOTAL_KOLOM = KOLOM.length;

const BARIS_JUDUL = 1;
const BARIS_IDENTITAS = 3;
const BARIS_HEADER = 8; // header dua tingkat: 8 (blok) + 9 (kolom)
const BARIS_DATA = 10;

export async function buildCcoXlsx(input: CcoXlsxInput): Promise<Buffer> {
  const { rows, totalLama, totalTambah, totalKurang, totalBaru } = susunBarisCco(input.lama, input.baru);
  const noCco = String(input.ccoNo).padStart(2, "0");

  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  const ws = wb.addWorksheet(`CCO-${noCco}`, {
    // Kunci header DAN dua kolom kiri: tabelnya 17 kolom, tanpa xSplit angka di
    // blok CCO-01 terbaca tanpa tahu itu baris pekerjaan apa.
    views: [{ state: "frozen", xSplit: 2, ySplit: BARIS_HEADER + 1 }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });
  // Header tabel diulang di tiap halaman cetak — dokumen ini puluhan halaman.
  ws.pageSetup.printTitlesRow = `${BARIS_HEADER}:${BARIS_HEADER + 1}`;

  KOLOM.forEach((k, i) => (ws.getColumn(i + 1).width = k.lebar));

  // ── Judul ──────────────────────────────────────────────────────────────────
  const judul = ws.getCell(BARIS_JUDUL, 1);
  judul.value = `CONTRACT CHANGE ORDER - ${noCco} (CCO - ${noCco})`;
  judul.font = { bold: true, size: 14 };
  judul.alignment = { horizontal: "center" };
  ws.mergeCells(BARIS_JUDUL, 1, BARIS_JUDUL, TOTAL_KOLOM);
  ws.getRow(BARIS_JUDUL).height = 22;

  // ── Identitas ──────────────────────────────────────────────────────────────
  const identitas: [string, string][] = [
    ["NAMA PAKET", input.workTitle ?? input.packageName],
    ["LOKASI", [input.locationName, input.address].filter(Boolean).join(" — ")],
    ["PENYEDIA JASA", input.vendorName ?? ""],
    ["NOMOR KONTRAK", input.contractNumber ?? ""],
  ];
  identitas.forEach(([label, nilai], i) => {
    const r = BARIS_IDENTITAS + i;
    const cLabel = ws.getCell(r, 1);
    cLabel.value = label;
    cLabel.font = { bold: true, size: 10 };
    ws.mergeCells(r, 1, r, 2);
    const cNilai = ws.getCell(r, 3);
    cNilai.value = `:  ${nilai}`;
    cNilai.font = { size: 10 };
    cNilai.alignment = { horizontal: "left" };
    ws.mergeCells(r, 3, r, TOTAL_KOLOM);
  });

  // ── Header dua tingkat ─────────────────────────────────────────────────────
  const H = BARIS_HEADER;
  const setHeader = (cell: ExcelJS.Cell, teks: string) => {
    cell.value = teks;
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EDF2" } };
    cell.border = GARIS;
  };

  // NO / URAIAN / KET membentang dua baris.
  for (const k of [KOL_NO, KOL_URAIAN, KOL_KET]) {
    const c = idx(k.key);
    ws.mergeCells(H, c, H + 1, c);
    setHeader(ws.getCell(H, c), k.judul);
  }
  let kursor = 3; // kolom pertama sesudah NO + URAIAN
  for (const blok of BLOK) {
    const dari = kursor;
    const sampai = kursor + blok.kolom.length - 1;
    ws.mergeCells(H, dari, H, sampai);
    setHeader(ws.getCell(H, dari), blok.judul);
    blok.kolom.forEach((k, i) => setHeader(ws.getCell(H + 1, dari + i), k.judul));
    kursor = sampai + 1;
  }
  // Sel header yang tidak kena merge tetap perlu latar + garis.
  for (const r of [H, H + 1]) {
    for (let c = 1; c <= TOTAL_KOLOM; c++) {
      const cell = ws.getRow(r).getCell(c);
      if (!cell.border) cell.border = GARIS;
      if (!cell.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EDF2" } };
    }
  }
  ws.getRow(H).height = 18;
  ws.getRow(H + 1).height = 28;

  // ── Isi tabel ──────────────────────────────────────────────────────────────
  let r = BARIS_DATA;
  for (const row of rows) {
    if (row.jenis === "total") break; // baris JUMLAH ditulis bersama kaki
    tulisBaris(ws, r, row, totalLama, totalBaru);
    r += 1;
  }

  // ── Kaki: JUMLAH · PPN · TOTAL NILAI ───────────────────────────────────────
  const ppn = (v: bigint) => (v * BigInt(Math.round(input.ppnPercent * 100))) / 10_000n;
  const kaki: [string, bigint, bigint, bigint, bigint, boolean][] = [
    ["JUMLAH", totalLama, totalTambah, totalKurang, totalBaru, true],
    [`PPN ${input.ppnPercent}%`, ppn(totalLama), ppn(totalTambah), ppn(totalKurang), ppn(totalBaru), false],
    [
      "TOTAL NILAI",
      totalLama + ppn(totalLama),
      totalTambah + ppn(totalTambah),
      totalKurang + ppn(totalKurang),
      totalBaru + ppn(totalBaru),
      true,
    ],
  ];
  for (const [label, a, b, c, d, tebal] of kaki) {
    const baris = ws.getRow(r);
    const cLabel = ws.getCell(r, 1);
    cLabel.value = label;
    cLabel.alignment = { horizontal: "right", vertical: "middle" };
    ws.mergeCells(r, 1, r, idx("hargaLama"));
    ws.getCell(r, idx("jumlahLama")).value = Number(a);
    ws.getCell(r, idx("jumlahTambah")).value = Number(b);
    ws.getCell(r, idx("jumlahKurang")).value = Number(c);
    ws.getCell(r, idx("jumlahBaru")).value = Number(d);
    if (label === "JUMLAH") {
      // Bobot total = 100% menurut definisinya; ditulis supaya kolomnya tidak
      // menggantung kosong tepat di baris yang paling diperiksa.
      ws.getCell(r, idx("bobotLama")).value = 100;
      ws.getCell(r, idx("bobotBaru")).value = 100;
    }
    for (let cc = 1; cc <= TOTAL_KOLOM; cc++) {
      const cell = baris.getCell(cc);
      cell.border = GARIS;
      cell.font = { size: 9, bold: tebal };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EDF2" } };
      const k = KOLOM[cc - 1]!;
      if (k.fmt) cell.numFmt = k.fmt;
      if (cc > 1 && cell.alignment == null) cell.alignment = { horizontal: k.rata };
    }
    baris.height = 17;
    r += 1;
  }

  // ── Catatan kaki: penyebut bobot ───────────────────────────────────────────
  // Kolom bobot di format aslinya tidak menyebut pembaginya. Persentase tanpa
  // penyebut tidak bisa diperiksa siapa pun, jadi penyebutnya ditulis.
  r += 1;
  const catatan = ws.getCell(r, 1);
  catatan.value =
    "Bobot MC-0, PEKERJAAN TAMBAH, dan PEKERJAAN KURANG dihitung terhadap nilai MC-0 (pra-PPN); " +
    "bobot CCO-01 terhadap nilai CCO-01 (pra-PPN). Kolom tambah/kurang dikosongkan bila item tidak berubah.";
  catatan.font = { size: 8, italic: true, color: { argb: "FF6B7280" } };
  catatan.alignment = { horizontal: "left" };
  ws.mergeCells(r, 1, r, TOTAL_KOLOM);

  // ── Tanda tangan ───────────────────────────────────────────────────────────
  r += 2;
  const ttd: [number, number, string, string][] = [
    [1, 4, "Disetujui Oleh", "PPK Pejabat Penandatangan Kontrak"],
    [idx("volumeTambah"), idx("bobotTambah"), "Diperiksa Oleh", "Konsultan Pengawas"],
    [idx("volumeBaru"), idx("bobotBaru"), "Dibuat Oleh", "Penyedia Jasa"],
  ];
  for (const [dari, sampai, atas, bawah] of ttd) {
    const tulis = (baris: number, teks: string, tebal = false) => {
      const cell = ws.getCell(baris, dari);
      cell.value = teks;
      cell.font = { size: 10, bold: tebal };
      cell.alignment = { horizontal: "center" };
      ws.mergeCells(baris, dari, baris, sampai);
    };
    tulis(r, atas);
    tulis(r + 1, bawah, true);
    tulis(r + 6, "(.................................................)");
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Baris tanpa isi keuangan sama sekali — tanpa volume, tanpa harga satuan, dan
 * nol di KEDUA revisi. Di RAB nyata ini sub-judul yang terlanjur tersimpan
 * sebagai `item` ("6.6.1. Penyiapan RK3K, terdiri atas :"). Mencetak `0` dan
 * `TETAP` untuknya cuma menambah derau. Aman diperlakukan sebagai judul: kedua
 * sisi nol dan tak berharga satuan, jadi tidak ada perubahan yang bisa
 * tersembunyi di baliknya.
 */
const tanpaIsi = (row: CcoRow) =>
  row.jenis === "item" &&
  row.volumeLama == null &&
  row.volumeBaru == null &&
  row.hargaLama == null &&
  row.jumlahLama === 0n &&
  row.jumlahBaru === 0n;

function tulisBaris(ws: ExcelJS.Worksheet, r: number, row: CcoRow, totalLama: bigint, totalBaru: bigint) {
  const judul = row.jenis === "judul" || tanpaIsi(row);
  const baris = ws.getRow(r);

  ws.getCell(r, idx("no")).value = row.no ? displayCode(row.no) : null;
  const uraian = ws.getCell(r, idx("uraian"));
  uraian.value = displayName(row.uraian);
  uraian.alignment = { indent: Math.min(row.depth, 6), wrapText: true, vertical: "middle" };

  if (!judul) {
    /*
     * NOL DIKOSONGKAN di blok TAMBAH/KURANG.
     *
     * Versi pertama menulis 0 di semua baris TETAP dengan alasan "kosong
     * terbaca belum diisi". Pada RAB nyata (±1.970 baris) hasilnya justru
     * ribuan "0" dan "0,00" yang menenggelamkan belasan baris yang benar-benar
     * berubah — persis keluhan user. Kosong di sini tidak ambigu karena kolom
     * KET sudah menyatakan TETAP untuk baris itu, dan catatan kaki menyebutnya.
     * Blok MC-0 dan CCO-01 tetap selalu terisi: itu nilai sungguhan.
     */
    const isi: Record<string, number | string | null> = {
      volumeLama: row.volumeLama,
      satuan: row.satuan,
      hargaLama: row.hargaLama,
      jumlahLama: Number(row.jumlahLama),
      bobotLama: bobotPersen(row.jumlahLama, totalLama),
      volumeTambah: row.jumlahTambah > 0n ? row.volumeTambah : null,
      jumlahTambah: row.jumlahTambah > 0n ? Number(row.jumlahTambah) : null,
      bobotTambah: row.jumlahTambah > 0n ? bobotPersen(row.jumlahTambah, totalLama) : null,
      volumeKurang: row.jumlahKurang > 0n ? row.volumeKurang : null,
      jumlahKurang: row.jumlahKurang > 0n ? Number(row.jumlahKurang) : null,
      bobotKurang: row.jumlahKurang > 0n ? bobotPersen(row.jumlahKurang, totalLama) : null,
      volumeBaru: row.volumeBaru,
      jumlahBaru: Number(row.jumlahBaru),
      bobotBaru: bobotPersen(row.jumlahBaru, totalBaru),
      ket: row.ket,
    };
    for (const [key, nilai] of Object.entries(isi)) ws.getCell(r, idx(key)).value = nilai;
  }

  for (let c = 1; c <= TOTAL_KOLOM; c++) {
    const cell = baris.getCell(c);
    const k = KOLOM[c - 1]!;
    cell.border = GARIS;
    cell.font = { size: 9, bold: judul };
    if (k.fmt) cell.numFmt = k.fmt;
    if (c !== idx("uraian")) cell.alignment = { horizontal: k.rata, vertical: "middle" };
    if (judul) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  }
  // Baris yang BERUBAH diberi latar tipis — pemeriksa mencari yang ini, dan di
  // dokumen 2.000 baris mencarinya lewat kolom KET saja terlalu lambat.
  if (!judul && row.ket && row.ket !== "TETAP") {
    const warna = row.ket === "KURANG" || row.ket === "HAPUS" ? "FFFDECEC" : "FFEAF6EC";
    for (let c = 1; c <= TOTAL_KOLOM; c++) {
      baris.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: warna } };
    }
  }
}
