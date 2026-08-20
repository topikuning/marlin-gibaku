import "server-only";
import ExcelJS from "exceljs";
import { ppnAmount, withPpn } from "@/lib/money";

/**
 * EKSPOR RAB AKTIF → .xlsx 3 sheet SALING TERTAUT FORMULA (permintaan user
 * 29 Juli 2026, pola "konsep file" RAB KKP):
 *
 *   1. "Resume"     — satu baris per kategori/bangunan, nilainya =rumus ke
 *                     subtotal Sub Resume; lalu JUMLAH, PPN, TOTAL, DIBULATKAN
 *                     (semuanya rumus, bukan angka mati).
 *   2. "Sub Resume" — per kategori: rincian anak langsungnya, nilai =rumus ke
 *                     baris Detail RAB; subtotal = SUM blok.
 *   3. "Detail RAB" — pohon lengkap; Jumlah item = ANGKA TERSIMPAN (angka mati),
 *                     Jumlah induk = penjumlahan sel anak-anaknya.
 *
 * Rumus di sini hanya MENJUMLAHKAN sel yang sudah ada, tidak pernah menurunkan
 * angka baru dari volume × harga satuan (DECISIONS 212 — lihat alasannya di
 * baris item). Setiap sel rumus membawa `result` = angka tersimpan DB, dan
 * karena semua daunnya angka mati, hasil rekalkulasi Excel identik dengan
 * angka aplikasi — bukan hanya sebelum rekalkulasi.
 */

export type RabExportNode = {
  id: string;
  parentId: string | null;
  kind: "kategori" | "sub" | "grup" | "item";
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
  unitPrice: number | null;
  amount: bigint;
};

export type RabExportInput = {
  locationName: string;
  packageName: string;
  contractNumber: string | null;
  vendorName: string | null;
  ppnPercent: number;
  revisionNo: number;
  totalValue: bigint;
  nodes: RabExportNode[];
};

const RUPIAH_FMT = "#,##0";
const VOL_FMT = "#,##0.000";

/**
 * Kode/nama TAMPILAN — data DB tidak diubah:
 * - `code` di DB bisa membawa suffix dedup internal (`VI#2`, `X.1#2`) hasil
 *   disambiguasi lineageKey saat impor; itu artefak teknis, dilarang tampil
 *   di dokumen ekspor.
 * - Nama dirapikan dari spasi ganda bawaan file sumber.
 *
 * KODE KATEGORI DIPAKAI APA ADANYA (DECISIONS 208).
 *
 * Versi sebelumnya menomori ulang kategori berurutan (I, II, III, …) dengan
 * alasan "file sumber kerap memuat roman loncat". Itu keliru dua kali:
 *
 * 1. Loncatnya kode BUKAN kesalahan. RAB yang aktif adalah hasil negosiasi
 *    RESMI; nomor bangunan di sana dirujuk kontrak, adendum, berita acara, dan
 *    laporan KKP. Menomori ulang membuat dokumen ekspor tidak bisa dicocokkan
 *    dengan berkas resmi mana pun — dan diam-diam, tanpa pemberitahuan.
 * 2. Penomoran ulangnya bahkan tidak konsisten: hanya kategori yang diubah,
 *    sedangkan anak-anaknya tetap membawa kode aslinya. Hasilnya file yang
 *    bertentangan dengan dirinya sendiri — kategori "II" berisi anak "III.1",
 *    yang membuat berkasnya tak bisa diimpor ulang (kode anak menunjuk
 *    kategori yang tak ada).
 *
 * Sejalan dengan DECISIONS 203: angka dan kode dari user dipakai apa adanya.
 */
const displayCode = (code: string) => code.replace(/#\d+$/, "").trim();
const displayName = (name: string) => name.replace(/\s+/g, " ").trim();

const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

function headerCell(cell: ExcelJS.Cell) {
  cell.font = { bold: true, size: 10 };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  cell.border = thin;
}

/** Judul blok identitas di atas tabel (3 baris, kolom A). */
function addTitle(ws: ExcelJS.Worksheet, judul: string, input: RabExportInput) {
  ws.getCell("A1").value = judul;
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value =
    `Lokasi: ${input.locationName} · Paket: ${input.packageName}` +
    (input.vendorName ? ` · ${input.vendorName}` : "");
  ws.getCell("A3").value =
    (input.contractNumber ? `Kontrak: ${input.contractNumber} · ` : "") +
    `RAB revisi aktif #${input.revisionNo}`;
  ws.getCell("A2").font = { size: 10 };
  ws.getCell("A3").font = { size: 10, color: { argb: "FF666666" } };
}

export async function buildRabXlsx(input: RabExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";

  const byParent = new Map<string | null, RabExportNode[]>();
  for (const n of input.nodes) {
    const arr = byParent.get(n.parentId) ?? [];
    arr.push(n);
    byParent.set(n.parentId, arr);
  }
  const kategoris = byParent.get(null) ?? [];

  /**
   * Kode kategori untuk KETIGA sheet — dari DB, apa adanya (DECISIONS 208).
   * Kategori tanpa kode sama sekali diberi penanda posisi agar kolom Kode tidak
   * kosong di dokumen resmi; itu satu-satunya kode yang kami karang, dan hanya
   * ketika tidak ada yang bisa dipakai.
   */
  const romanOf = new Map<string, string>();
  kategoris.forEach((k, i) => romanOf.set(k.id, displayCode(k.code) || `(${i + 1})`));

  // Urutan tab: Resume → Sub Resume → Detail RAB (dibuat dulu semua supaya
  // urut, lalu DIISI dari Detail karena dua sheet lain menunjuk ke barisnya).
  const res = wb.addWorksheet("Resume", { views: [{ state: "frozen", ySplit: 5 }] });
  const sub = wb.addWorksheet("Sub Resume", { views: [{ state: "frozen", ySplit: 5 }] });
  const det = wb.addWorksheet("Detail RAB", { views: [{ state: "frozen", ySplit: 5 }] });
  det.columns = [
    { width: 10 }, // A kode
    { width: 52 }, // B uraian
    { width: 12 }, // C volume
    { width: 8 }, // D sat
    { width: 15 }, // E harga satuan
    { width: 17 }, // F jumlah
  ];
  addTitle(det, "RENCANA ANGGARAN BIAYA – DETAIL", input);
  const detHeaderRow = 5;
  const detHeaders = ["Kode", "Uraian Pekerjaan", "Volume", "Sat", "Harga Satuan (Rp)", "Jumlah (Rp)"];
  detHeaders.forEach((h, i) => {
    const c = det.getCell(detHeaderRow, i + 1);
    c.value = h;
    headerCell(c);
  });

  /** Baris Detail per node id — dipakai rumus antar-sheet. */
  const detRowOf = new Map<string, number>();
  let r = detHeaderRow;

  const writeNode = (n: RabExportNode, depth: number) => {
    r += 1;
    const row = r;
    detRowOf.set(n.id, row);
    det.getCell(row, 1).value = n.kind === "kategori" ? romanOf.get(n.id)! : displayCode(n.code);
    det.getCell(row, 1).alignment = { horizontal: "center", vertical: "top" };
    // Hierarki lewat indent NATIF Excel, bukan spasi literal di teks.
    det.getCell(row, 2).value = displayName(n.name);
    det.getCell(row, 2).alignment = { indent: depth, wrapText: true, vertical: "top" };
    if (n.kind === "item") {
      det.getCell(row, 3).value = n.volume ?? 0;
      det.getCell(row, 3).numFmt = VOL_FMT;
      det.getCell(row, 4).value = n.unit ?? "";
      det.getCell(row, 5).value = n.unitPrice ?? 0;
      det.getCell(row, 5).numFmt = RUPIAH_FMT;
      // ANGKA MATI, bukan ROUND(volume×harga) — DECISIONS 212.
      //
      // Harga satuan di dokumen sumber sudah dibulatkan (2 desimal) dari analisa
      // harga satuan yang presisinya lebih panjang, jadi ROUND(vol×harga) TIDAK
      // sama dengan Jumlah yang tertulis di dokumen. Pada RAB Wonorejo: 152 dari
      // 1.227 baris meleset Rp1–4, dan begitu Excel merekalkulasi seluruh pohon
      // ikut bergeser sampai Rp3.697 di nilai pra-PPN — lalu PPN dan TOTAL
      // dihitung di atas angka yang sudah melenceng.
      //
      // Nilai yang diunggah user dipakai apa adanya (DECISIONS 203): berkas
      // unduhan harus SAMA PERSIS dengan layar dan dengan dokumen kontrak, juga
      // sesudah Excel menghitung ulang. Baris induk tetap berumus karena
      // subtotal tersimpan memang PERSIS Σ anak tersimpan (diverifikasi atas
      // 218 baris agregat: nol selisih), jadi rumusnya tidak menggeser apa pun.
      det.getCell(row, 6).value = Number(n.amount);
    } else {
      det.getRow(row).font = { bold: depth === 0, italic: depth > 0 };
      if (n.kind === "kategori") {
        for (let c = 1; c <= 6; c++) {
          det.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
        }
      }
      const children = byParent.get(n.id) ?? [];
      for (const c of children) writeNode(c, depth + 1);
      const parts = children.map((c) => `F${detRowOf.get(c.id)!}`);
      det.getCell(row, 6).value = parts.length
        ? { formula: parts.join("+"), result: Number(n.amount) }
        : 0;
    }
    det.getCell(row, 6).numFmt = RUPIAH_FMT;
    if (n.kind !== "item") det.getCell(row, 6).font = { bold: true };
    for (let c = 1; c <= 6; c++) det.getCell(row, c).border = thin;
    det.getCell(row, 4).alignment = { horizontal: "center" };
  };
  for (const kat of kategoris) writeNode(kat, 0);

  // Baris jumlah pra-PPN di Detail (rumus ke sel kategori).
  r += 1;
  const detTotalRow = r;
  det.getCell(detTotalRow, 2).value = "JUMLAH (pra-PPN)";
  det.getCell(detTotalRow, 2).font = { bold: true };
  det.getCell(detTotalRow, 6).value = {
    formula: kategoris.map((k) => `F${detRowOf.get(k.id)!}`).join("+") || "0",
    result: Number(input.totalValue),
  };
  det.getCell(detTotalRow, 6).numFmt = RUPIAH_FMT;
  det.getCell(detTotalRow, 6).font = { bold: true };
  for (let c = 1; c <= 6; c++) det.getCell(detTotalRow, c).border = thin;

  /* ── Sheet 2: Sub Resume — anak langsung tiap kategori, tertaut ke Detail ── */
  sub.columns = [{ width: 10 }, { width: 56 }, { width: 18 }];
  addTitle(sub, "RENCANA ANGGARAN BIAYA – SUB RESUME", input);
  const subHeaderRow = 5;
  ["Kode", "Uraian", "Jumlah Harga (Rp)"].forEach((h, i) => {
    const c = sub.getCell(subHeaderRow, i + 1);
    c.value = h;
    headerCell(c);
  });

  /** Baris subtotal kategori di Sub Resume — dipakai sheet Resume. */
  const subTotalRowOf = new Map<string, number>();
  let s = subHeaderRow;
  for (const kat of kategoris) {
    s += 1;
    sub.getCell(s, 1).value = romanOf.get(kat.id)!;
    sub.getCell(s, 1).alignment = { horizontal: "center" };
    sub.getCell(s, 2).value = displayName(kat.name);
    sub.getRow(s).font = { bold: true };
    for (let c = 1; c <= 3; c++) {
      sub.getCell(s, c).border = thin;
      sub.getCell(s, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
    }
    const children = byParent.get(kat.id) ?? [];
    const childRows: number[] = [];
    for (const c of children) {
      s += 1;
      childRows.push(s);
      sub.getCell(s, 1).value = displayCode(c.code);
      sub.getCell(s, 1).alignment = { horizontal: "center" };
      sub.getCell(s, 2).value = displayName(c.name);
      sub.getCell(s, 2).alignment = { indent: 1, wrapText: true };
      sub.getCell(s, 3).value = {
        formula: `'Detail RAB'!F${detRowOf.get(c.id)!}`,
        result: Number(c.amount),
      };
      sub.getCell(s, 3).numFmt = RUPIAH_FMT;
      for (let cc = 1; cc <= 3; cc++) sub.getCell(s, cc).border = thin;
    }
    s += 1;
    subTotalRowOf.set(kat.id, s);
    sub.getCell(s, 2).value = `JUMLAH ${romanOf.get(kat.id)!} – ${displayName(kat.name)}`;
    sub.getCell(s, 2).font = { bold: true };
    sub.getCell(s, 3).value = childRows.length
      ? { formula: childRows.map((cr) => `C${cr}`).join("+"), result: Number(kat.amount) }
      : 0;
    sub.getCell(s, 3).numFmt = RUPIAH_FMT;
    sub.getCell(s, 3).font = { bold: true };
    sub.getCell(s, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
    for (let cc = 1; cc <= 3; cc++) sub.getCell(s, cc).border = thin;
    s += 1; // baris kosong antar blok
  }

  /* ── Sheet 1: Resume — kategori tertaut ke Sub Resume + PPN + pembulatan ── */
  res.columns = [{ width: 6 }, { width: 56 }, { width: 18 }];
  addTitle(res, "RENCANA ANGGARAN BIAYA – RESUME", input);
  const resHeaderRow = 5;
  ["No", "Uraian Pekerjaan", "Jumlah Harga (Rp)"].forEach((h, i) => {
    const c = res.getCell(resHeaderRow, i + 1);
    c.value = h;
    headerCell(c);
  });
  let q = resHeaderRow;
  const katRows: number[] = [];
  kategoris.forEach((kat) => {
    q += 1;
    katRows.push(q);
    res.getCell(q, 1).value = romanOf.get(kat.id)!;
    res.getCell(q, 1).alignment = { horizontal: "center" };
    res.getCell(q, 2).value = displayName(kat.name);
    res.getCell(q, 3).value = {
      formula: `'Sub Resume'!C${subTotalRowOf.get(kat.id)!}`,
      result: Number(kat.amount),
    };
    res.getCell(q, 3).numFmt = RUPIAH_FMT;
    for (let cc = 1; cc <= 3; cc++) res.getCell(q, cc).border = thin;
  });

  // result cache dari formula kanonik lib/money — bukan hitungan lokal baru.
  const jumlah = Number(input.totalValue);
  const ppn = Number(ppnAmount(input.totalValue, input.ppnPercent));
  const total = Number(withPpn(input.totalValue, input.ppnPercent));
  const bulat = Math.floor(total / 1000) * 1000;

  const tulisTotal = (label: string, value: ExcelJS.CellValue, fmt = RUPIAH_FMT) => {
    q += 1;
    res.getCell(q, 2).value = label;
    res.getCell(q, 2).font = { bold: true };
    res.getCell(q, 3).value = value;
    res.getCell(q, 3).numFmt = fmt;
    res.getCell(q, 3).font = { bold: true };
    for (let cc = 1; cc <= 3; cc++) res.getCell(q, cc).border = thin;
    return q;
  };
  const rowJumlah = tulisTotal("JUMLAH", {
    formula: katRows.length ? katRows.map((kr) => `C${kr}`).join("+") : "0",
    result: jumlah,
  });
  const rowPpn = tulisTotal(`PPN ${input.ppnPercent}%`, {
    formula: `ROUND(C${rowJumlah}*${input.ppnPercent}%,0)`,
    result: ppn,
  });
  const rowTotal = tulisTotal("JUMLAH TOTAL", {
    formula: `C${rowJumlah}+C${rowPpn}`,
    result: total,
  });
  tulisTotal("DIBULATKAN", {
    formula: `ROUNDDOWN(C${rowTotal},-3)`,
    result: bulat,
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
