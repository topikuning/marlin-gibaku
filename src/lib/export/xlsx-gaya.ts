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

/** 1 piksel = 9525 EMU (satuan panjang OOXML). */
const EMU_PER_PX = 9525;

/**
 * Titik jangkar gambar untuk tepi KIRI di `xPx`, dinyatakan sebagai kolom
 * 0-based + simpangan EMU.
 *
 * SENGAJA tidak memakai koordinat kolom PECAHAN yang disediakan exceljs:
 * konversinya (`anchor.js`) memakai `lebarKolom × 10000` sebagai penyebut,
 * padahal `nativeColOff` dibaca Excel sebagai EMU. Kolom selebar 14 karakter
 * (±103 px) jadi diperlakukan seakan 140000 EMU (±14,7 px), sehingga pecahan
 * 0,85 hanya menggeser gambar ±12 px — logo yang seharusnya di tengah mendarat
 * jauh di kiri. Menulis `nativeColOff` sendiri melewati konversi itu.
 */
function jangkarX(ws: ExcelJS.Worksheet, xPx: number, kolomTerakhir: number): { col: number; offEmu: number } {
  let x = 0;
  for (let c = 1; c <= kolomTerakhir; c++) {
    const w = kolomPx(ws.getColumn(c).width);
    if (xPx < x + w) return { col: c - 1, offEmu: Math.max(0, Math.round((xPx - x) * EMU_PER_PX)) };
    x += w;
  }
  return { col: kolomTerakhir, offEmu: 0 };
}

/** Total lebar piksel kolom 1..`kolomTerakhir`. */
function lebarPx(ws: ExcelJS.Worksheet, kolomTerakhir: number): number {
  let x = 0;
  for (let c = 1; c <= kolomTerakhir; c++) x += kolomPx(ws.getColumn(c).width);
  return x;
}

/** Penempatan logo di dalam satu blok kolom. */
export type PosisiLogo = {
  /** Nomor baris Excel (1-based) tempat sisi atas gambar diletakkan. */
  rowAtas: number;
  tinggiPx: number;
  /** Blok kolom acuan (1-based, inklusif) — logo disejajarkan ke blok INI. */
  kolomKiri: number;
  kolomKanan: number;
};

/**
 * Rasio gambar DIJAGA: tinggi ditetapkan, lebar mengikuti. Meregangkan logo
 * perusahaan ke kotak seragam adalah cara tercepat membuat dokumen resmi
 * terlihat asal jadi.
 */
function tempelLogo(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  g: LogoGambar,
  o: { row: number; tinggiPx: number; xKiri: number; kolomKanan: number },
): void {
  const w = lebarLogo(g, o.tinggiPx);
  const { col, offEmu } = jangkarX(ws, Math.max(0, o.xKiri), o.kolomKanan);
  const id = wb.addImage({ buffer: g.buffer as unknown as ExcelJS.Buffer, extension: "png" });
  ws.addImage(id, {
    tl: { nativeCol: col, nativeColOff: offEmu, nativeRow: Math.max(0, o.row - 1), nativeRowOff: 0 },
    ext: { width: w, height: o.tinggiPx },
    editAs: "oneCell",
  } as unknown as Parameters<ExcelJS.Worksheet["addImage"]>[1]);
}

const lebarLogo = (g: LogoGambar, tinggiPx: number): number => Math.round(g.width * (tinggiPx / g.height));

/**
 * SATU logo di TENGAH blok — tata letak sampul berkas acuan KKP: logo pemilik
 * pekerjaan di puncak halaman, logo kontraktor di atas keterangannya, keduanya
 * terpusat. (Koreksi user 2026-08-06: tata letaknya sudah ada di contoh; jangan
 * dikarang sendiri jadi kiri–kanan.)
 */
export function logoTengah(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  g: LogoGambar | null,
  o: PosisiLogo,
): void {
  if (!g) return; // Logo yang belum diunggah dilewati — tanpa kotak kosong.
  const xKiri = lebarPx(ws, o.kolomKiri - 1);
  const xKanan = lebarPx(ws, o.kolomKanan);
  tempelLogo(wb, ws, g, {
    row: o.rowAtas,
    tinggiPx: o.tinggiPx,
    xKiri: xKiri + (xKanan - xKiri - lebarLogo(g, o.tinggiPx)) / 2,
    kolomKanan: o.kolomKanan,
  });
}

/**
 * SEPASANG logo BERJAJAR di sisi KANAN blok — tata letak sheet rekap berkas
 * acuan: identitas paket di kiri, logo pemilik & kontraktor berdampingan di
 * kanan. Urutannya pemilik dulu, lalu kontraktor.
 */
export function logoPasanganKanan(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  logo: LogoLaporan | undefined,
  o: PosisiLogo & { jarakPx?: number },
): void {
  const daftar = [logo?.pemilik, logo?.kontraktor].filter((g): g is LogoGambar => !!g);
  if (daftar.length === 0) return;
  const jarak = o.jarakPx ?? 14;
  const lebar = daftar.map((g) => lebarLogo(g, o.tinggiPx));
  const total = lebar.reduce((a, b) => a + b, 0) + jarak * (daftar.length - 1);
  let x = Math.max(lebarPx(ws, o.kolomKiri - 1), lebarPx(ws, o.kolomKanan) - total);
  daftar.forEach((g, i) => {
    tempelLogo(wb, ws, g, { row: o.rowAtas, tinggiPx: o.tinggiPx, xKiri: x, kolomKanan: o.kolomKanan });
    x += lebar[i] + jarak;
  });
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
      o.h.vendorName?.trim() ? `Penyedia Jasa – ${o.h.vendorName.trim()}` : "Penyedia Jasa",
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
