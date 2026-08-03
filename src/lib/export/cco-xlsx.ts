import "server-only";
import ExcelJS from "exceljs";
import { susunBarisCco, bobotPersen, type CcoNode, type CcoRow } from "@/lib/rab/cco-rows";

/**
 * DOKUMEN CCO (Contract Change Order) — format berkas contoh dari KKP,
 * sheet "CCO-01 (BANGUNAN)". Permintaan user 2026-08-03: "ini adalah draft
 * format yang diminta kkp untuk pengajuan cco. akomodir ini".
 *
 * POSISI KOLOM DIPERTAHANKAN PERSIS dengan berkas contoh (B–V), supaya
 * pemeriksa KKP membaca dokumen yang sama bentuknya, bukan yang mirip:
 *
 *   B     NO
 *   C:E   URAIAN PEKERJAAN
 *   F:L   MC - 0            → F volume · I satuan · J harga satuan · K jumlah · L bobot
 *   M:O   PEKERJAAN TAMBAH  → M volume · N jumlah · O bobot
 *   P:R   PEKERJAAN KURANG  → P volume · Q jumlah · R bobot
 *   S:U   CCO - 01          → S volume · T jumlah · U bobot
 *   V     KET
 *
 * G dan H sengaja DIBIARKAN KOSONG — di berkas contoh pun keduanya kosong di
 * seluruh baris data, dan menggesernya akan memindahkan semua kolom sesudahnya.
 *
 * DUA HAL YANG SENGAJA TIDAK DISALIN dari berkas contoh:
 *
 * 1. Blok kanan (X "KET", Y–AA "CCO-PRC", AB–AD "CCO-PERENCANA", AG–AI "BIAYA
 *    PELAKSANAAN") — kertas kerja konsultan, dan di berkas contoh isinya
 *    `#REF!`. Keputusan user 2026-08-03: "b-v saja".
 * 2. Baris identitas PROGRAM / KEGIATAN / JENIS PENGADAAN / PAGU / SUMBER DANA
 *    — tidak satu pun ada di MARLIN. Keputusan user: "dihide, abaikan saja
 *    dulu". Mencetak labelnya dengan nilai karangan lebih buruk daripada tidak
 *    mencetaknya: ini dokumen pengajuan resmi.
 */

const RUPIAH_FMT = "#,##0";
const VOL_FMT = "#,##0.000";
const PCT_FMT = "0.00";

const thin: Partial<ExcelJS.Borders> = {
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
  /** Nomor CCO, mis. 1 → judul "CONTRACT CHANGE ORDER - 01 (CCO - 01)". */
  ccoNo: number;
  lama: CcoNode[];
  baru: CcoNode[];
};

const SHEET = "CCO-01";

export async function buildCcoXlsx(input: CcoXlsxInput): Promise<Buffer> {
  const { rows, totalLama, totalTambah, totalKurang, totalBaru } = susunBarisCco(input.lama, input.baru);

  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  const ws = wb.addWorksheet(SHEET, {
    views: [{ state: "frozen", ySplit: 26 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // Lebar kolom mengikuti berkas contoh.
  const lebar: [string, number][] = [
    ["A", 3], ["B", 7], ["C", 16], ["D", 2.2], ["E", 48], ["F", 12.4], ["G", 6], ["H", 12.8],
    ["I", 10], ["J", 16], ["K", 20], ["L", 9], ["M", 13.4], ["N", 20], ["O", 9],
    ["P", 13.4], ["Q", 20], ["R", 9], ["S", 13.4], ["T", 20], ["U", 9], ["V", 12],
  ];
  for (const [col, w] of lebar) ws.getColumn(col).width = w;

  // ── Kepala dokumen (baris 13–20, sama seperti contoh) ───────────────────────
  ws.getCell("B13").value = `CONTRACT CHANGE ORDER - ${String(input.ccoNo).padStart(2, "0")} (CCO - ${String(input.ccoNo).padStart(2, "0")})`;
  ws.getCell("B13").font = { bold: true, size: 14 };
  ws.getCell("B13").alignment = { horizontal: "center" };
  ws.mergeCells("B13:V13");

  const identitas: [string, string][] = [
    ["NAMA PAKET", input.workTitle ?? input.packageName],
    ["LOKASI", [input.locationName, input.address].filter(Boolean).join(" — ")],
    ["PENYEDIA JASA", input.vendorName ?? ""],
    ["NOMOR KONTRAK", input.contractNumber ?? ""],
  ];
  identitas.forEach(([label, nilai], i) => {
    const r = 15 + i;
    ws.getCell(`B${r}`).value = label;
    ws.getCell(`D${r}`).value = ":";
    ws.getCell(`E${r}`).value = nilai;
    ws.getCell(`B${r}`).font = { bold: true, size: 10 };
    ws.getCell(`E${r}`).font = { size: 10 };
  });

  // ── Header tabel (baris 23–26, tiga tingkat seperti contoh) ─────────────────
  const H = 23;
  const grup: [string, string][] = [
    [`F${H}:L${H}`, "MC - 0"],
    [`M${H}:O${H}`, "PEKERJAAN TAMBAH"],
    [`P${H}:R${H}`, "PEKERJAAN KURANG"],
    [`S${H}:U${H}`, "CCO - 01"],
  ];
  for (const [range, teks] of grup) {
    ws.mergeCells(range);
    ws.getCell(range.split(":")[0]!).value = teks;
  }
  ws.mergeCells(`B${H}:B${H + 3}`);
  ws.getCell(`B${H}`).value = "NO";
  ws.mergeCells(`C${H}:E${H + 3}`);
  ws.getCell(`C${H}`).value = "URAIAN PEKERJAAN";
  ws.mergeCells(`V${H}:V${H + 3}`);
  ws.getCell(`V${H}`).value = "KET";

  // Baris 24: nama besaran · 25: rincian · 26: satuan angka.
  const sub: [string, string, string, string][] = [
    ["F", "VOLUME", "", ""],
    ["I", "SATUAN", "", ""],
    ["J", "HARGA", "SATUAN", "Rp."],
    ["K", "JUMLAH", "HARGA", "Rp."],
    ["L", "BOBOT", "", "%"],
    ["M", "VOLUME", "", ""],
    ["N", "JUMLAH", "HARGA", "(Rp)"],
    ["O", "NILAI", "BOBOT", "(%)"],
    ["P", "VOLUME", "", ""],
    ["Q", "JUMLAH", "HARGA", "(Rp)"],
    ["R", "NILAI", "BOBOT", "(%)"],
    ["S", "VOLUME", "", ""],
    ["T", "JUMLAH", "HARGA", "(Rp)"],
    ["U", "NILAI", "BOBOT", "(%)"],
  ];
  for (const [col, a, b, c] of sub) {
    if (!b && !c) {
      ws.mergeCells(`${col}${H + 1}:${col}${H + 3}`);
      ws.getCell(`${col}${H + 1}`).value = a;
    } else if (!b) {
      ws.mergeCells(`${col}${H + 1}:${col}${H + 2}`);
      ws.getCell(`${col}${H + 1}`).value = a;
      ws.getCell(`${col}${H + 3}`).value = c;
    } else {
      ws.getCell(`${col}${H + 1}`).value = a;
      ws.getCell(`${col}${H + 2}`).value = b;
      ws.getCell(`${col}${H + 3}`).value = c;
    }
  }
  for (let r = H; r <= H + 3; r++) {
    for (let c = 2; c <= 22; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.font = { bold: true, size: 9 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      cell.border = thin;
    }
  }

  // ── Isi tabel ──────────────────────────────────────────────────────────────
  let r = H + 4;
  for (const row of rows) {
    tulisBaris(ws, r, row, totalLama, totalBaru);
    r += 1;
  }

  // ── Kaki: PPN + TOTAL NILAI ────────────────────────────────────────────────
  const ppn = (v: bigint) => (v * BigInt(Math.round(input.ppnPercent * 100))) / 10_000n;
  const kaki: [string, bigint, bigint, bigint, bigint][] = [
    [`PPN ${input.ppnPercent}%`, ppn(totalLama), ppn(totalTambah), ppn(totalKurang), ppn(totalBaru)],
    ["TOTAL NILAI", totalLama + ppn(totalLama), totalTambah + ppn(totalTambah), totalKurang + ppn(totalKurang), totalBaru + ppn(totalBaru)],
  ];
  for (const [label, a, b, c, d] of kaki) {
    ws.mergeCells(`F${r}:J${r}`);
    ws.getCell(`F${r}`).value = label;
    ws.getCell(`K${r}`).value = Number(a);
    ws.getCell(`N${r}`).value = Number(b);
    ws.getCell(`Q${r}`).value = Number(c);
    ws.getCell(`T${r}`).value = Number(d);
    for (let c2 = 2; c2 <= 22; c2++) {
      const cell = ws.getRow(r).getCell(c2);
      cell.font = { bold: true, size: 9 };
      cell.border = thin;
      if ([11, 14, 17, 20].includes(c2)) cell.numFmt = RUPIAH_FMT;
    }
    ws.getCell(`F${r}`).alignment = { horizontal: "right" };
    r += 1;
  }

  // ── Catatan kaki: penyebut bobot ───────────────────────────────────────────
  // Kolom bobot di format aslinya tidak menyebut pembaginya. Persentase tanpa
  // penyebut tidak bisa diperiksa siapa pun, jadi penyebutnya ditulis.
  r += 1;
  ws.getCell(`B${r}`).value =
    "Bobot MC-0, PEKERJAAN TAMBAH, dan PEKERJAAN KURANG dihitung terhadap nilai MC-0 (pra-PPN); " +
    "bobot CCO-01 dihitung terhadap nilai CCO-01 (pra-PPN).";
  ws.getCell(`B${r}`).font = { size: 8, italic: true, color: { argb: "FF666666" } };
  ws.mergeCells(`B${r}:V${r}`);

  // ── Blok tanda tangan (mengikuti contoh) ───────────────────────────────────
  r += 2;
  const ttd: [string, string, string][] = [
    ["E", "Disetujui Oleh", "PPK Pejabat Penandatangan Kontrak"],
    ["K", "Diperiksa Oleh", "Konsultan Pengawas"],
    ["S", "Dibuat Oleh", "Penyedia Jasa"],
  ];
  for (const [col, atas, bawah] of ttd) {
    ws.getCell(`${col}${r}`).value = atas;
    ws.getCell(`${col}${r + 1}`).value = bawah;
    ws.getCell(`${col}${r + 7}`).value = "…...................................................";
    for (const rr of [r, r + 1, r + 7]) {
      ws.getCell(`${col}${rr}`).font = { size: 10 };
      ws.getCell(`${col}${rr}`).alignment = { horizontal: "center" };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function tulisBaris(ws: ExcelJS.Worksheet, r: number, row: CcoRow, totalLama: bigint, totalBaru: bigint) {
  const judul = row.jenis === "judul";
  const total = row.jenis === "total";

  ws.getCell(`B${r}`).value = row.no ? displayCode(row.no) : null;
  ws.mergeCells(`C${r}:E${r}`);
  ws.getCell(`C${r}`).value = displayName(row.uraian);
  ws.getCell(`C${r}`).alignment = { indent: Math.min(row.depth, 6), wrapText: true, vertical: "middle" };

  if (!judul) {
    // Angka MC-0 / tambah / kurang / CCO-01. Nilai nol pada baris item TETAP
    // ditulis 0, bukan dikosongkan: kosong terbaca "belum diisi".
    ws.getCell(`F${r}`).value = row.volumeLama;
    ws.getCell(`I${r}`).value = row.satuan;
    ws.getCell(`J${r}`).value = row.hargaLama;
    ws.getCell(`K${r}`).value = Number(row.jumlahLama);
    ws.getCell(`L${r}`).value = bobotPersen(row.jumlahLama, totalLama);
    ws.getCell(`M${r}`).value = row.volumeTambah;
    ws.getCell(`N${r}`).value = Number(row.jumlahTambah);
    ws.getCell(`O${r}`).value = bobotPersen(row.jumlahTambah, totalLama);
    ws.getCell(`P${r}`).value = row.volumeKurang;
    ws.getCell(`Q${r}`).value = Number(row.jumlahKurang);
    ws.getCell(`R${r}`).value = bobotPersen(row.jumlahKurang, totalLama);
    ws.getCell(`S${r}`).value = row.volumeBaru;
    ws.getCell(`T${r}`).value = Number(row.jumlahBaru);
    ws.getCell(`U${r}`).value = bobotPersen(row.jumlahBaru, totalBaru);
    ws.getCell(`V${r}`).value = row.ket;
  }

  for (let c = 2; c <= 22; c++) {
    const cell = ws.getRow(r).getCell(c);
    cell.border = thin;
    cell.font = { size: 9, bold: judul || total };
    if ([6, 13, 16, 19].includes(c)) cell.numFmt = VOL_FMT;
    if ([10, 11, 14, 17, 20].includes(c)) cell.numFmt = RUPIAH_FMT;
    if ([12, 15, 18, 21].includes(c)) cell.numFmt = PCT_FMT;
    if (c === 22) cell.alignment = { horizontal: "center" };
    if (judul) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6F6" } };
    if (total) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
  }
}
