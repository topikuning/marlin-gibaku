import type ExcelJS from "exceljs";

/**
 * PENGATURAN CETAK SEMUA EXCEL BUATAN MARLIN (DECISIONS 762).
 *
 * Satu pintu: kertas, orientasi, dan skala cetak hanya diatur di sini, dipanggil
 * tepat sebelum `writeBuffer`. Tanpa ini Excel memakai kertas bawaan printer
 * (sering Letter) dan sheet lebar terpotong ke beberapa halaman ke samping.
 *
 * Aturannya:
 * - Kertas SELALU A4.
 * - Selalu muat satu halaman ke samping; ke bawah boleh berapa halaman pun
 *   (kecuali sheet yang memang satu halaman, mis. sampul).
 * - Orientasi DINILAI dari isi sheet, bukan ditetapkan per berkas:
 *   1. orientasi yang membuat huruf lebih kecil dari {@link HURUF_MIN_PT} pt
 *      setelah diperkecil tidak dipakai;
 *   2. dari yang tersisa, yang halamannya lebih sedikit menang – rekap pendek
 *      yang muat satu halaman potret tidak dipecah jadi dua halaman lanskap
 *      dengan nama penanda tangan terpisah dari jabatannya;
 *   3. jumlah halaman sama → potret selama hurufnya masih
 *      {@link HURUF_NYAMAN_PT} pt atau lebih, selain itu lanskap.
 *   Sheet yang kolom atau barisnya bertambah (minggu kurva-S, kolom backup
 *   volume, item RAB) ikut dinilai ulang setiap kali berkas dibuat.
 */

/** Kode ukuran kertas A4 di format .xlsx. */
export const KERTAS_A4 = 9;

/** Di bawah ini huruf hasil cetak dianggap tidak terbaca, pt. */
export const HURUF_MIN_PT = 7;
/** Huruf hasil cetak yang masih nyaman, pt – dasar memilih potret saat halamannya sama. */
export const HURUF_NYAMAN_PT = 8;

const A4_PENDEK_MM = 210;
const A4_PANJANG_MM = 297;
const MM_PER_INCI = 25.4;
const MM_PER_PT = MM_PER_INCI / 72;
/** Lebar kolom Excel (satuan karakter Calibri 11) → piksel layar 96 dpi. */
const PIKSEL_PER_KARAKTER = 7;
const LEBAR_BAWAAN = 8.43;
const TINGGI_BARIS_BAWAAN_PT = 15;
const HURUF_BAWAAN_PT = 11;
/** Margin bawaan Excel (inci) bila sheet tidak menetapkannya. */
const MARGIN_BAWAAN = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 };

export type Orientasi = "portrait" | "landscape";

export type CetakSatuArah = {
  /** Skala cetak supaya muat satu halaman ke samping, dibatasi 1. */
  skala: number;
  /** Ukuran huruf utama setelah diperkecil, pt. */
  hurufPt: number;
  /** Perkiraan jumlah halaman ke bawah. */
  halaman: number;
};

export type PenilaianCetak = {
  orientasi: Orientasi;
  /** Lebar & tinggi isi sheet pada skala 100%, mm. */
  lebarMm: number;
  tinggiMm: number;
  /** Ukuran huruf yang paling banyak dipakai sel berisi, pt. */
  hurufPt: number;
  potret: CetakSatuArah;
  lanskap: CetakSatuArah;
};

/** Ukuran huruf yang paling banyak dipakai sel berisi (seri → yang lebih kecil). */
function hurufUtama(ws: ExcelJS.Worksheet): number {
  const hitung = new Map<number, number>();
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value == null || cell.value === "") return;
      const pt = cell.font?.size ?? HURUF_BAWAAN_PT;
      hitung.set(pt, (hitung.get(pt) ?? 0) + 1);
    });
  });
  let terbaik = HURUF_BAWAAN_PT;
  let jumlah = -1;
  for (const [pt, n] of hitung) {
    if (n > jumlah || (n === jumlah && pt < terbaik)) {
      terbaik = pt;
      jumlah = n;
    }
  }
  return terbaik;
}

/** Lebar isi sheet di kertas (mm), kolom tersembunyi tidak dihitung. */
function lebarIsiMm(ws: ExcelJS.Worksheet): number {
  const bawaan = ws.properties.defaultColWidth ?? LEBAR_BAWAAN;
  let piksel = 0;
  for (let c = 1; c <= ws.columnCount; c++) {
    const kol = ws.getColumn(c);
    if (kol.hidden) continue;
    const lebar = kol.width ?? bawaan;
    if (lebar <= 0) continue;
    piksel += lebar * PIKSEL_PER_KARAKTER;
  }
  return (piksel / 96) * MM_PER_INCI;
}

/**
 * Tinggi isi sheet (mm), baris tersembunyi tidak dihitung. Perkiraan: baris
 * tanpa tinggi tetap dihitung setinggi bawaan, walau teks terbungkus bisa
 * membuatnya lebih tinggi saat dibuka.
 */
function tinggiIsiMm(ws: ExcelJS.Worksheet): number {
  const bawaan = ws.properties.defaultRowHeight || TINGGI_BARIS_BAWAAN_PT;
  let pt = 0;
  for (let r = 1; r <= ws.rowCount; r++) {
    const baris = ws.getRow(r);
    if (baris.hidden) continue;
    pt += baris.height ?? bawaan;
  }
  return pt * MM_PER_PT;
}

function margin(ws: ExcelJS.Worksheet) {
  const m = ws.pageSetup.margins;
  return {
    left: m?.left ?? MARGIN_BAWAAN.left,
    right: m?.right ?? MARGIN_BAWAAN.right,
    top: m?.top ?? MARGIN_BAWAAN.top,
    bottom: m?.bottom ?? MARGIN_BAWAAN.bottom,
  };
}

/** Ruang cetak A4 pada orientasi itu, mm. */
export function ruangCetakMm(ws: ExcelJS.Worksheet, orientasi: Orientasi): { lebar: number; tinggi: number } {
  const m = margin(ws);
  const [lebarKertas, tinggiKertas] =
    orientasi === "portrait" ? [A4_PENDEK_MM, A4_PANJANG_MM] : [A4_PANJANG_MM, A4_PENDEK_MM];
  return {
    lebar: lebarKertas - (m.left + m.right) * MM_PER_INCI,
    tinggi: tinggiKertas - (m.top + m.bottom) * MM_PER_INCI,
  };
}

/** Nilai orientasi yang pas untuk satu sheet, tanpa mengubah apa pun. */
export function nilaiCetak(ws: ExcelJS.Worksheet): PenilaianCetak {
  const lebarMm = lebarIsiMm(ws);
  const tinggiMm = tinggiIsiMm(ws);
  const hurufPt = hurufUtama(ws);
  const arah = (o: Orientasi): CetakSatuArah => {
    const ruang = ruangCetakMm(ws, o);
    const skala = lebarMm > 0 ? Math.min(1, ruang.lebar / lebarMm) : 1;
    return {
      skala,
      hurufPt: hurufPt * skala,
      halaman: Math.max(1, Math.ceil((tinggiMm * skala) / ruang.tinggi - 1e-9)),
    };
  };
  const potret = arah("portrait");
  const lanskap = arah("landscape");

  let orientasi: Orientasi;
  if (potret.hurufPt < HURUF_MIN_PT) orientasi = "landscape";
  else if (lanskap.hurufPt < HURUF_MIN_PT) orientasi = "portrait";
  else if (potret.halaman !== lanskap.halaman) orientasi = potret.halaman < lanskap.halaman ? "portrait" : "landscape";
  else orientasi = potret.hurufPt >= HURUF_NYAMAN_PT ? "portrait" : "landscape";

  return { orientasi, lebarMm, tinggiMm, hurufPt, potret, lanskap };
}

/**
 * Siapkan SEMUA sheet buku kerja untuk dicetak di A4. Panggil tepat sebelum
 * `wb.xlsx.writeBuffer()` – setelah kolom & isi selesai, karena orientasinya
 * dinilai dari situ. Margin yang sudah ditetapkan sheet dipertahankan.
 */
export function siapCetakA4(
  wb: ExcelJS.Workbook,
  opsi?: {
    /** Nama sheet yang harus muat SATU halaman (sampul). */
    satuHalaman?: readonly string[];
  },
): void {
  const satu = new Set(opsi?.satuHalaman ?? []);
  for (const ws of wb.worksheets) {
    const { orientasi } = nilaiCetak(ws);
    ws.pageSetup.paperSize = KERTAS_A4;
    ws.pageSetup.orientation = orientasi;
    ws.pageSetup.fitToPage = true;
    ws.pageSetup.fitToWidth = 1;
    ws.pageSetup.fitToHeight = satu.has(ws.name) ? 1 : 0;
  }
}
