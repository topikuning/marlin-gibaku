import type ExcelJS from "exceljs";
import type { PeriodHeader } from "@/lib/periodic-report";
import type { LogoGambar, LogoLaporan } from "@/lib/export/logo-laporan";
import { formatTanggal } from "@/lib/format";

/**
 * GAYA BERSAMA workbook laporan periodik (DECISIONS 265).
 *
 * Blanko KKP aslinya memakai warna bawaan Excel 2003 (kuning terang, hijau
 * neon, garis tebal ganda). User meminta palet sendiri: "gunakan komposisi
 * warna yang menurutmu enak dilihat mata dan profesional, gunakan referensi
 * standar pemain besar."
 *
 * Palet di bawah = navy tunggal + netral abu-biru, meniru kebiasaan laporan
 * proyek kontraktor besar / konsultan: SATU warna identitas untuk kepala tabel,
 * turunannya yang makin pucat untuk hierarki baris (kategori → subtotal →
 * jumlah), dan warna semantik HANYA untuk angka yang punya arti baik/buruk
 * (deviasi). Tidak ada warna dekoratif — tiap warna menandai satu hal.
 *
 * STRUKTUR sheet lama TIDAK diubah oleh berkas ini; ia hanya menyeragamkan
 * rupa. Perubahan struktur ada di xlsx.ts.
 */

export const WARNA = {
  /** Navy identitas — kepala tabel & judul. */
  kepala: "FF1B4560",
  /** Turunan navy untuk baris kepala kedua/ketiga (kelompok kolom). */
  kepalaSub: "FF2E6B8F",
  /** Baris judul kategori. */
  kategori: "FFE3ECF2",
  /** Baris subtotal kategori. */
  subtotal: "FFF2F6F9",
  /** Baris JUMLAH / TOTAL. */
  total: "FFCFDDE7",
  /** Latar blok identitas (kop). */
  identitas: "FFF7FAFC",
  teksTerang: "FFFFFFFF",
  teks: "FF1B2733",
  teksRedup: "FF5B6B7B",
  garis: "FFA9BCCB",
  garisTegas: "FF1B4560",
  positif: "FF166534",
  negatif: "FFB42318",
} as const;

/** Format angka: dua desimal, pemisah ribuan (Excel id-ID menampilkannya koma). */
export const FMT_ANGKA = "#,##0.00";
/** Rupiah tanpa desimal — nilai kontrak selalu bulat rupiah. */
export const FMT_RUPIAH = '"Rp"#,##0';
/** Persen yang SUDAH dalam satuan persen (bukan pecahan) — jangan pakai 0.00%. */
export const FMT_PERSEN = '#,##0.00"%"';

const tipis = { style: "thin" as const, color: { argb: WARNA.garis } };
export const KOTAK: ExcelJS.Borders = {
  top: tipis,
  bottom: tipis,
  left: tipis,
  right: tipis,
} as ExcelJS.Borders;

const rambut = { style: "hair" as const, color: { argb: WARNA.garis } };
export const KOTAK_HALUS: ExcelJS.Borders = {
  top: rambut,
  bottom: rambut,
  left: rambut,
  right: rambut,
} as ExcelJS.Borders;

export const isi = (argb: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});

/** Kepala tabel: navy penuh + teks putih tebal, rata tengah, bungkus teks. */
export function gayaKepala(cell: ExcelJS.Cell, opts?: { sub?: boolean; size?: number }): void {
  cell.font = { bold: true, size: opts?.size ?? 9, color: { argb: WARNA.teksTerang } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.fill = isi(opts?.sub ? WARNA.kepalaSub : WARNA.kepala);
  cell.border = KOTAK;
}

/* ── Logo kop ─────────────────────────────────────────────────────────────── */

/** Lebar kolom Excel → piksel (aproksimasi Calibri 11 yang dipakai penampil). */
const kolomPx = (width: number | undefined): number => Math.round((width ?? 8.43) * 7 + 5);

/**
 * Kolom pecahan tempat sebuah gambar harus ditempel agar tepi KIRI-nya jatuh di
 * `xPx`. Gambar XLSX ditempel pada koordinat kolom/baris, bukan piksel, jadi
 * posisinya harus dihitung dari lebar kolom sheet yang bersangkutan.
 */
function kolomDiX(ws: ExcelJS.Worksheet, xPx: number, kolomTerakhir: number): number {
  let x = 0;
  for (let c = 1; c <= kolomTerakhir; c++) {
    const w = kolomPx(ws.getColumn(c).width);
    if (xPx < x + w) return c - 1 + (xPx - x) / w;
    x += w;
  }
  return kolomTerakhir;
}

/** Total lebar piksel kolom 1..`kolomTerakhir`. */
function lebarPx(ws: ExcelJS.Worksheet, kolomTerakhir: number): number {
  let x = 0;
  for (let c = 1; c <= kolomTerakhir; c++) x += kolomPx(ws.getColumn(c).width);
  return x;
}

/**
 * KOP BERLOGO: pemilik pekerjaan di kiri, kontraktor pelaksana di kanan —
 * mengikuti berkas acuan KKP (koreksi user 2026-08-06).
 *
 * Rasio gambar DIJAGA: logo dimuat beserta ukuran aslinya lalu dimuat-paskan ke
 * kotak setinggi `tinggiPx`. Meregangkan logo perusahaan ke kotak tetap adalah
 * cara paling cepat membuat dokumen resmi terlihat asal jadi.
 *
 * Logo yang tidak ada hanya dilewati — tidak ada kotak kosong, tidak ada teks
 * pengganti. Sisi yang kosong memang berarti logonya belum diunggah.
 */
export function pasangLogoKop(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  logo: LogoLaporan | undefined,
  o: {
    rowAtas: number;
    tinggiPx: number;
    /** Blok kolom tempat logo disejajarkan (1-based, inklusif). */
    kolomKiri: number;
    kolomKanan: number;
  },
): void {
  if (!logo?.pemilik && !logo?.kontraktor) return;
  // Disejajarkan ke BLOK ISI, bukan ke tepi sheet: pada sampul, judul & seluruh
  // identitas dimerge di kolom tengah, dan logo yang rata tepi kertas terlihat
  // lepas dari kopnya.
  const xKiri = lebarPx(ws, o.kolomKiri - 1);
  const xKanan = lebarPx(ws, o.kolomKanan);
  // `rowAtas` 1-based (nomor baris Excel) → koordinat gambar 0-based.
  const row = Math.max(0, o.rowAtas - 1);

  const tempel = (g: LogoGambar, kiri: number) => {
    const w = Math.round(g.width * (o.tinggiPx / g.height));
    const id = wb.addImage({ buffer: g.buffer as unknown as ExcelJS.Buffer, extension: "png" });
    ws.addImage(id, {
      tl: { col: kolomDiX(ws, kiri, o.kolomKanan), row },
      ext: { width: w, height: o.tinggiPx },
      editAs: "oneCell",
    });
    return w;
  };

  if (logo.pemilik) tempel(logo.pemilik, xKiri);
  if (logo.kontraktor) {
    const w = Math.round(logo.kontraktor.width * (o.tinggiPx / logo.kontraktor.height));
    tempel(logo.kontraktor, Math.max(xKiri, xKanan - w));
  }
}

/**
 * BLOK TANDA TANGAN — permintaan user 2026-08-06 ("untuk kurva s juga sepertinya
 * kamu cukup kasih tambahan tanda tangan di bawah itu saja").
 *
 * Tiga pihak, urutan blanko KKP: Mengetahui (PPK) — Diperiksa (Konsultan
 * Pengawas) — Dibuat Oleh (Penyedia Jasa). Nama yang BELUM diisi di kontrak
 * ditulis sebagai garis titik-titik, bukan dikosongkan diam-diam: dokumen cetak
 * tetap bisa ditandatangani manual, dan pembaca tahu kolomnya memang belum
 * terisi (bukan hilang).
 */
export function blokTandaTangan(
  ws: ExcelJS.Worksheet,
  o: { lastCol: number; h: PeriodHeader; tanggal?: Date },
): void {
  const L = Math.max(3, o.lastCol);
  const lebar = Math.floor(L / 3);
  const blok: [number, number][] = [
    [1, lebar],
    [lebar + 1, lebar * 2],
    [lebar * 2 + 1, L],
  ];

  const tulis = (
    teks: (string | null)[],
    gaya: { bold?: boolean; size?: number; color?: string; garisAtas?: boolean },
  ) => {
    const row = ws.addRow([]);
    blok.forEach(([a, b], i) => {
      const cell = row.getCell(a);
      cell.value = teks[i] ?? null;
      cell.font = {
        bold: gaya.bold ?? false,
        size: gaya.size ?? 9,
        color: { argb: gaya.color ?? WARNA.teks },
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      if (b > a) ws.mergeCells(row.number, a, row.number, b);
      if (gaya.garisAtas) {
        for (let c = a; c <= b; c++) {
          ws.getRow(row.number).getCell(c).border = {
            top: { style: "thin", color: { argb: WARNA.garisTegas } },
          };
        }
      }
    });
    return row;
  };

  ws.addRow([]);
  // Tempat & tanggal hanya di blok kanan (pihak yang membuat dokumen).
  // Tanggal yang tidak diketahui (mis. Time Schedule berdiri sendiri, sebelum
  // ada periode laporan) ditulis sebagai tempat saja — TIDAK ditebak jadi hari
  // ini, dan tidak boleh menggagalkan seluruh ekspor.
  const tgl = o.tanggal ?? o.h.periodeEnd;
  const tglSah = tgl instanceof Date && Number.isFinite(tgl.getTime());
  tulis([null, null, tglSah ? `${o.h.regency}, ${formatTanggal(tgl, "d MMMM yyyy")}` : `${o.h.regency},`], {
    size: 9,
  });
  tulis(["Mengetahui,", "Diperiksa,", "Dibuat Oleh,"], { size: 9, color: WARNA.teksRedup });
  tulis(
    [
      "Pejabat Pembuat Komitmen",
      o.h.supervisorFirm?.trim() || "Konsultan Pengawas",
      o.h.vendorName?.trim() ? `Penyedia Jasa — ${o.h.vendorName.trim()}` : "Penyedia Jasa",
    ],
    { bold: true, size: 9 },
  );
  // Ruang membubuhkan tanda tangan & cap basah.
  for (let i = 0; i < 4; i++) ws.addRow([]).height = 15;

  const garisTtd = "( ……………………………………… )";
  tulis(
    [
      o.h.ppkName?.trim() ? `( ${o.h.ppkName.trim()} )` : garisTtd,
      o.h.supervisorName?.trim() ? `( ${o.h.supervisorName.trim()} )` : garisTtd,
      o.h.contractorSignerName?.trim() ? `( ${o.h.contractorSignerName.trim()} )` : garisTtd,
    ],
    { bold: true, size: 9, garisAtas: true },
  );
  tulis(
    [
      o.h.ppkNip?.trim() ? `NIP. ${o.h.ppkNip.trim()}` : null,
      o.h.supervisorName?.trim() ? "Konsultan Pengawas" : null,
      o.h.contractorSignerTitle?.trim() || null,
    ],
    { size: 8, color: WARNA.teksRedup },
  );
}
