import "server-only";
import ExcelJS from "exceljs";
import type { RabExportNode } from "./rab-xlsx";

/**
 * TEMPLATE KERJA ADENDUM (.xlsx) — permintaan user 2026-08-02: "aku juga butuh
 * template adendum, kamu harusnya dari rab yang ada bisa export format untuk
 * adendum".
 *
 * Ini BUKAN lampiran resmi adendum, melainkan berkas kerja: unduh dari RAB
 * aktif, isi kolom VOLUME ADENDUM di Excel, lalu impor balik ke draft adendum.
 * Perbandingan lama↔baru dan rekap tambah/kurang tetap disusun sistem saat
 * impor, bukan diketik ulang di sini.
 *
 * Tiga keputusan yang membentuk berkas ini (DECISIONS 216):
 *
 * 1. HARGA SATUAN ITEM KONTRAK LAMA TERKUNCI (DECISIONS 213). Sheet
 *    diproteksi; hanya VOLUME ADENDUM dan blok item baru yang bisa diketik.
 *    Proteksi Excel tanpa sandi memang bisa dibuka siapa saja — itu memang
 *    tujuannya: ia rambu, bukan gembok. Gembok sebenarnya ada di impor, yang
 *    tetap menandai harga item lama yang bergeser.
 *
 * 2. IDENTITAS ITEM = `lineageKey`, ditulis di kolom terakhir dan disembunyikan.
 *    Baris BER-lineageKey = item kontrak yang sudah ada. Baris TANPA lineageKey
 *    di dalam blok kategori = ITEM BARU untuk kategori itu. Dengan begitu user
 *    bebas menyisipkan baris di mana pun tanpa memakai jatah "baris kosong"
 *    yang jumlahnya ditebak-tebak, dan tanpa pernah bisa salah menautkan
 *    realisasi ke item yang keliru.
 *
 * 3. VOLUME 0 ≠ DIHAPUS. Nol berarti volumenya nol dan itemnya TETAP tercantum
 *    di RAB dengan nilai nol — pernyataan yang berbeda dari "item dicabut", dan
 *    di adendum keduanya nyata. Mencabut item harus dinyatakan terang-terangan
 *    lewat kolom KETERANGAN diisi `HAPUS`. Menebak maksud user dari angka nol
 *    adalah cara paling mudah menghilangkan pekerjaan yang sudah dikerjakan.
 */

const RUPIAH_FMT = '#,##0;[Red]-#,##0';
const VOL_FMT = "#,##0.###";
/** Angka realisasi di dalam pesan validasi — dibaca manusia, bukan sel. */
const VOL_ID = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const thin = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

/** Penanda supaya parser yakin berkas ini template, bukan RAB/HPS biasa. */
export const ADENDUM_TEMPLATE_SHEET = "Template Adendum";
export const ADENDUM_TEMPLATE_MARKER = "MARLIN:TEMPLATE-ADENDUM:v1";
/** Baris header tabel (1-indexed) — parser memakai angka yang sama. */
export const ADENDUM_HEADER_ROW = 8;

/**
 * Node RAB + `lineageKey`. Template WAJIB membawanya: itulah identitas yang
 * menautkan baris di Excel kembali ke item kontrak saat diimpor, dan yang
 * menjaga realisasi tidak pernah nyasar ke item lain.
 */
export type AdendumTemplateNode = RabExportNode & { lineageKey: string };

export type AdendumTemplateInput = {
  locationName: string;
  packageName: string;
  contractNumber: string | null;
  vendorName: string | null;
  revisionNo: number;
  totalValue: bigint;
  nodes: AdendumTemplateNode[];
  /**
   * Volume yang SUDAH terealisasi di lapangan per lineageKey. Tanpa ini berkas
   * template bisu soal pengaman terpenting adendum: volume tidak boleh turun
   * di bawah pekerjaan yang sudah dikerjakan, dan item ber-realisasi tidak
   * boleh dicabut. Server memang menolaknya, tapi baru SESUDAH berkas diunggah
   * balik — padahal berkas ini diisi jauh dari aplikasi. DECISIONS 242.
   */
  realisasiByLineage?: Map<string, number>;
};

export async function buildAdendumTemplateXlsx(input: AdendumTemplateInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  const ws = wb.addWorksheet(ADENDUM_TEMPLATE_SHEET, {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: ADENDUM_HEADER_ROW }],
  });

  ws.columns = [
    { width: 10 }, // A kode
    { width: 52 }, // B uraian
    { width: 12 }, // C volume kontrak
    { width: 8 }, // D satuan
    { width: 15 }, // E harga satuan
    { width: 17 }, // F jumlah kontrak
    { width: 14 }, // G VOLUME ADENDUM  ← isian
    { width: 17 }, // H jumlah adendum
    { width: 15 }, // I selisih
    { width: 26 }, // J keterangan
    { width: 1 }, // K lineageKey (disembunyikan)
    { width: 16 }, // L realisasi tercatat (baca saja)
  ];
  ws.getColumn(11).hidden = true;

  const judul = (row: number, text: string, bold = false, size = 10) => {
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { bold, size };
  };
  judul(1, "TEMPLATE ADENDUM — RENCANA ANGGARAN BIAYA", true, 12);
  judul(2, `${input.locationName} · ${input.packageName}${input.vendorName ? ` · ${input.vendorName}` : ""}`);
  judul(
    3,
    `${input.contractNumber ? `Kontrak: ${input.contractNumber} · ` : ""}Disalin dari RAB revisi aktif #${input.revisionNo}`,
  );
  // Petunjuk pengisian ditulis DI BERKASNYA, bukan hanya di layar: berkas ini
  // beredar lewat WhatsApp dan email, jauh dari aplikasi yang menerbitkannya.
  judul(4, "CARA MENGISI:", true);
  judul(5, "1. Isi kolom VOLUME ADENDUM (kolom G) — itu volume SETELAH adendum, bukan selisihnya.");
  judul(
    6,
    "2. Item baru: sisipkan baris di dalam kategori yang sesuai, isi Kode/Uraian/Volume Adendum/Satuan/Harga Satuan. Kolom paling kanan biarkan kosong.",
  );
  judul(
    7,
    "3. Mencabut item: tulis HAPUS di kolom KETERANGAN. Volume 0 BUKAN penghapusan — artinya item tetap ada dengan volume nol. " +
      "Kolom REALISASI TERCATAT (L) = pekerjaan yang SUDAH dikerjakan: Volume Adendum tidak boleh di bawahnya dan item " +
      "ber-realisasi tidak bisa di-HAPUS. Sel yang melanggar berubah MERAH dan ditolak saat diunggah.",
  );
  ws.getCell(7, 1).font = { bold: false, size: 10, color: { argb: "FFB00020" } };

  const header = [
    "Kode",
    "Uraian Pekerjaan",
    "Volume Kontrak",
    "Sat",
    "Harga Satuan (Rp)",
    "Jumlah Kontrak (Rp)",
    "VOLUME ADENDUM",
    "Jumlah Adendum (Rp)",
    "Selisih (Rp)",
    "Keterangan (isi HAPUS untuk mencabut)",
    ADENDUM_TEMPLATE_MARKER,
    "Realisasi Tercatat",
  ];
  header.forEach((text, i) => {
    const c = ws.getCell(ADENDUM_HEADER_ROW, i + 1);
    c.value = text;
    c.font = { bold: true, size: 9 };
    c.alignment = { horizontal: i === 1 ? "left" : "center", vertical: "middle", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i === 6 ? "FFFFF2CC" : "FFEFEFEF" } };
    c.border = border;
  });
  ws.getRow(ADENDUM_HEADER_ROW).height = 30;

  const byParent = new Map<string | null, AdendumTemplateNode[]>();
  for (const n of input.nodes) {
    const arr = byParent.get(n.parentId) ?? [];
    arr.push(n);
    byParent.set(n.parentId, arr);
  }

  /** Baris item yang punya realisasi — dipakai memasang sorotan merah. */
  const barisBerealisasi: number[] = [];
  let row = ADENDUM_HEADER_ROW;
  const tulis = (n: AdendumTemplateNode, depth: number) => {
    row += 1;
    const r = row;
    ws.getCell(r, 1).value = n.code;
    ws.getCell(r, 1).alignment = { horizontal: "center", vertical: "top" };
    ws.getCell(r, 2).value = n.name;
    ws.getCell(r, 2).alignment = { indent: depth, wrapText: true, vertical: "top" };
    ws.getCell(r, 11).value = n.lineageKey;

    if (n.kind === "item") {
      ws.getCell(r, 3).value = n.volume ?? 0;
      ws.getCell(r, 3).numFmt = VOL_FMT;
      ws.getCell(r, 4).value = n.unit ?? "";
      ws.getCell(r, 4).alignment = { horizontal: "center" };
      ws.getCell(r, 5).value = n.unitPrice ?? 0;
      ws.getCell(r, 5).numFmt = RUPIAH_FMT;
      // Jumlah Kontrak = ANGKA TERSIMPAN, bukan ROUND(vol×harga) — alasan
      // lengkapnya di DECISIONS 212: harga satuan dokumen sudah dibulatkan,
      // jadi hasil kali tidak sama dengan Jumlah yang tertulis di kontrak.
      ws.getCell(r, 6).value = Number(n.amount);
      ws.getCell(r, 6).numFmt = RUPIAH_FMT;
      // Prasi volume adendum = volume kontrak. User tinggal mengubah yang
      // berubah; yang tidak disentuh dijamin identik dengan kontrak (parser
      // memakai Jumlah Kontrak apa adanya untuk baris yang volumenya tetap).
      const g = ws.getCell(r, 7);
      g.value = n.volume ?? 0;
      g.numFmt = VOL_FMT;
      g.protection = { locked: false };
      g.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9E6" } };
      ws.getCell(r, 8).value = { formula: `ROUND(G${r}*E${r},0)`, result: Number(n.amount) };
      ws.getCell(r, 8).numFmt = RUPIAH_FMT;
      ws.getCell(r, 9).value = { formula: `H${r}-F${r}`, result: 0 };
      ws.getCell(r, 9).numFmt = RUPIAH_FMT;
      ws.getCell(r, 10).protection = { locked: false };

      /*
       * PENGAMAN DI LEVEL BERKAS (DECISIONS 242).
       *
       * Server menolak volume di bawah realisasi dan menolak mencabut item
       * ber-realisasi — tetapi baru SESUDAH berkas diunggah balik. Berkas ini
       * diisi jauh dari aplikasi (WhatsApp/email), kerap oleh orang yang tidak
       * punya akses MARLIN, jadi menunda kabar sampai unggah berarti pekerjaan
       * ulang satu berkas penuh.
       *
       * Excel tidak bisa MENCEGAH (validasi bisa ditembus tempel-salin), jadi
       * ini rambu berlapis: nilainya ditulis, entri di bawahnya ditolak dengan
       * pesan, dan pelanggaran yang lolos tetap berubah merah.
       */
      const realisasi = input.realisasiByLineage?.get(n.lineageKey) ?? 0;
      const l = ws.getCell(r, 12);
      l.value = realisasi;
      l.numFmt = VOL_FMT;
      l.font = { size: 9, bold: realisasi > 0 };
      l.alignment = { horizontal: "right" };
      l.border = border;
      if (realisasi > 0) {
        l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF6EC" } };
        g.dataValidation = {
          type: "decimal",
          operator: "greaterThanOrEqual",
          formulae: [`$L$${r}`],
          allowBlank: false,
          showErrorMessage: true,
          // "stop", BUKAN "error": OOXML hanya mengenal stop/warning/information.
          // ExcelJS menerima nilai apa pun dan menuliskannya apa adanya, dan berkas
          // yang dihasilkan DITOLAK pembaca lain (Excel: "unreadable content").
          errorStyle: "stop",
          errorTitle: "Di bawah realisasi",
          error:
            `Item ini sudah dikerjakan ${VOL_ID.format(realisasi)}${n.unit ? ` ${n.unit}` : ""} di lapangan ` +
            `(kolom REALISASI TERCATAT). Volume adendum tidak boleh di bawahnya — pekerjaan-kurang atas item ` +
            `berjalan maksimal sampai volume yang sudah terealisasi.`,
        };
        barisBerealisasi.push(r);
      }
    } else {
      ws.getRow(r).font = { bold: depth === 0, italic: depth > 0, size: 9 };
      if (n.kind === "kategori") {
        for (let c = 1; c <= 10; c++) {
          ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
        }
      }
      ws.getCell(r, 6).value = Number(n.amount);
      ws.getCell(r, 6).numFmt = RUPIAH_FMT;
      for (const c of byParent.get(n.id) ?? []) tulis(c, depth + 1);
    }
    for (let c = 1; c <= 12; c++) {
      if (c === 11) continue; // kolom penanda (disembunyikan)
      ws.getCell(r, c).border = border;
      if (!ws.getCell(r, c).font) ws.getCell(r, c).font = { size: 9 };
    }
  };
  for (const kat of byParent.get(null) ?? []) tulis(kat, 0);

  // Sorotan MERAH untuk pelanggaran yang lolos dari validasi (mis. tempel-salin
  // dari berkas lain, atau berkas dibuka di aplikasi yang mengabaikan validasi).
  for (const r of barisBerealisasi) {
    ws.addConditionalFormatting({
      ref: `G${r}`,
      rules: [
        {
          type: "expression",
          formulae: [`$G$${r}<$L$${r}`],
          priority: 1,
          style: {
            font: { bold: true, color: { argb: "FF9F1239" } },
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDECEC" } },
          },
        },
      ],
    });
    // HAPUS atas item ber-realisasi: dilarang, apa pun volumenya.
    ws.addConditionalFormatting({
      ref: `J${r}`,
      rules: [
        {
          type: "expression",
          formulae: [`EXACT(UPPER($J$${r}),"HAPUS")`],
          priority: 1,
          style: {
            font: { bold: true, color: { argb: "FF9F1239" } },
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDECEC" } },
          },
        },
      ],
    });
  }

  // Baris total: pembanding cepat sebelum berkas dikirim balik.
  row += 2;
  ws.getCell(row, 2).value = "NILAI KONTRAK BERJALAN (pra-PPN)";
  ws.getCell(row, 2).font = { bold: true, size: 9 };
  ws.getCell(row, 6).value = Number(input.totalValue);
  ws.getCell(row, 6).numFmt = RUPIAH_FMT;
  ws.getCell(row, 6).font = { bold: true, size: 9 };

  // Proteksi = RAMBU, bukan gembok (lihat catatan kepala berkas). Tanpa sandi
  // supaya user yang memang perlu bisa membukanya, dan impor tetap memeriksa.
  await ws.protect("", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    insertRows: true,
    deleteRows: true,
    formatColumns: true,
    formatRows: true,
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
