import type ExcelJS from "exceljs";
import { penandatanganDokumen, peranSlot, type JenisDokumen } from "@/lib/laporan/penandatangan";
import type { PeriodHeader } from "@/lib/periodic-report";
import type { LogoGambar, LogoLaporan } from "@/lib/export/logo-laporan";
import { formatTanggal } from "@/lib/format";
import { kotakTtdKetik, rasioPng, ukuranTtd } from "@/lib/export/ttd-ukuran";

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

/* ── Tanda tangan & stempel (DECISIONS 757) ───────────────────────────────── */

/** Berkas PNG satu pihak – bentuk yang sama dengan `BerkasTtd` di lib/pdf/ttd-gambar. */
export type BerkasTtdXlsx = {
  ttd: Buffer | null;
  stempel: Buffer | null;
  /** `ttd` adalah tanda tangan KETIK dari nama (DECISIONS 763) – lebarnya mengikuti nama. */
  ttdKetik?: boolean;
};
/** Gambar tiga pihak blanko KKP – sama bentuknya dengan `TtdPdf` (dimuat `muatTtdPdf`). */
export type GambarTtdXlsx = { ppk: BerkasTtdXlsx; pengawas: BerkasTtdXlsx; penyedia: BerkasTtdXlsx };

/** Lebar & tinggi PNG dari kepala IHDR; null bila bukan PNG. */
export function ukuranPng(b: Buffer): { w: number; h: number } | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Tinggi baris dalam piksel; baris tanpa tinggi = bawaan Excel 15 pt. */
const tinggiBarisPx = (ws: ExcelJS.Worksheet, row: number): number =>
  Math.round(((ws.getRow(row).height ?? 15) * 4) / 3);

/** Jangkar (baris 0-based + simpangan EMU) titik `naikPx` di ATAS tepi atas baris `row`. */
function jangkarYNaik(ws: ExcelJS.Worksheet, row: number, naikPx: number): { row: number; offEmu: number } {
  let sisa = naikPx;
  for (let r = row - 1; r >= 1; r--) {
    const h = tinggiBarisPx(ws, r);
    if (sisa <= h) return { row: r - 1, offEmu: Math.round((h - sisa) * EMU_PER_PX) };
    sisa -= h;
  }
  return { row: 0, offEmu: 0 };
}

/**
 * Tempel tanda tangan & stempel ke blok tanda tangan Excel (DECISIONS 757).
 *
 * Keluhan user 2026-11-11: tanda tangan dan stempel hanya ada di PDF, jadi
 * Excel harus ditandatangani ulang – "bikin orang kerja ganda". Aturannya
 * SAMA dengan PDF (`gambarTtdPdf`):
 * - ukuran dari `ttd-ukuran` (lebar kolom, direm ruang di atas baris nama);
 * - stempel digambar lebih dulu, coretan sesudahnya; Excel menumpuk gambar
 *   menurut urutan tambahnya, jadi coretan berada di atas stempel;
 * - coretan berpijak tepat di baris nama, stempel turun sedikit menimpanya;
 * - rasio gambar dijaga (`fit`), tidak diregangkan;
 * - tidak ada yang naik melewati `rowAtasBlok`, supaya tidak menembus tabel.
 *
 * Mengembalikan jumlah gambar yang ditempel.
 */
export function tempelTtdXlsx(
  ws: ExcelJS.Worksheet,
  o: {
    blok: { kolomKiri: number; kolomKanan: number; berkas: BerkasTtdXlsx }[];
    /** Baris nama (1-based) – coretan berpijak di tepi atasnya. */
    rowNama: number;
    /** Baris pertama blok tanda tangan (1-based). */
    rowAtasBlok: number;
  },
): number {
  const wb = ws.workbook;
  let ruang = 0;
  for (let r = o.rowAtasBlok; r < o.rowNama; r++) ruang += tinggiBarisPx(ws, r);
  let jumlah = 0;
  for (const b of o.blok) {
    const xKiri = lebarPx(ws, b.kolomKiri - 1);
    const xKanan = lebarPx(ws, b.kolomKanan);
    const xTengah = (xKiri + xKanan) / 2;
    const u = ukuranTtd(xKanan - xKiri, ruang);
    const pasang = (buf: Buffer, kotak: { lebar: number; tinggi: number }, kiriKotak: number, turun: number) => {
      const d = ukuranPng(buf);
      if (!d || kotak.lebar <= 0 || kotak.tinggi <= 0) return;
      const skala = Math.min(kotak.lebar / d.w, kotak.tinggi / d.h);
      const w = Math.max(1, Math.round(d.w * skala));
      const h = Math.max(1, Math.round(d.h * skala));
      const { col, offEmu } = jangkarX(ws, Math.max(0, kiriKotak + (kotak.lebar - w) / 2), b.kolomKanan);
      const y = jangkarYNaik(ws, o.rowNama, Math.min(h - turun, ruang));
      const id = wb.addImage({ buffer: buf as unknown as ExcelJS.Buffer, extension: "png" });
      ws.addImage(id, {
        tl: { nativeCol: col, nativeColOff: offEmu, nativeRow: y.row, nativeRowOff: y.offEmu },
        ext: { width: w, height: h },
        editAs: "oneCell",
      } as unknown as Parameters<ExcelJS.Worksheet["addImage"]>[1]);
      jumlah++;
    };
    if (b.berkas.stempel) pasang(b.berkas.stempel, u.stempel, xTengah - u.stempel.lebar / 2 - u.geser, u.turun);
    if (b.berkas.ttd) {
      // Tanda tangan ketik: setinggi coretan, selebar namanya (DECISIONS 763).
      const rasio = b.berkas.ttdKetik ? rasioPng(b.berkas.ttd) : null;
      const k = rasio ? kotakTtdKetik(u, xKanan - xKiri, rasio) : u.ttd;
      pasang(b.berkas.ttd, k, xTengah - k.lebar / 2, 0);
    }
  }
  return jumlah;
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
  o: {
    lastCol: number;
    h: PeriodHeader;
    tanggal?: Date;
    jenis: JenisDokumen;
    /** Gambar tanda tangan & stempel untuk dokumen ini (DECISIONS 757); kosong = ruang pena. */
    gambar?: GambarTtdXlsx | null;
  },
): void {
  // Siapa yang meneken bergantung dokumennya (DECISIONS 402) — dan jawabannya
  // hanya boleh datang dari satu tempat, supaya PDF dan Excel dari laporan yang
  // sama tidak pernah menyebut dua orang berbeda.
  const tt = penandatanganDokumen(o.jenis, o.h);
  // Pihak yang meneken dokumen ini, urut blanko. Kurva S paket tanpa slot
  // konsultan: dua blok, PPK dan penyedia (DECISIONS 764).
  const pihak = [
    { slot: tt.kkp, judul: "Mengetahui,", gambar: o.gambar?.ppk },
    ...(tt.konsultan ? [{ slot: tt.konsultan, judul: "Diperiksa,", gambar: o.gambar?.pengawas }] : []),
    { slot: tt.penyedia, judul: "Dibuat Oleh,", gambar: o.gambar?.penyedia },
  ];
  const n = pihak.length;
  const L = Math.max(n, o.lastCol);
  const lebar = Math.floor(L / n);
  const blok: [number, number][] = pihak.map((_, i) => [i * lebar + 1, i === n - 1 ? L : (i + 1) * lebar]);

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
  const kanan = (t: string | null) => pihak.map((_, i) => (i === n - 1 ? t : null));
  tulis(kanan(tglSah ? `${o.h.regency}, ${formatTanggal(tgl, "d MMMM yyyy")}` : `${o.h.regency},`), {
    size: 9,
  });
  const barisAtas = tulis(pihak.map((p) => p.judul), { size: 9, color: WARNA.teksRedup }).number;
  tulis(pihak.map((p) => peranSlot(p.slot)), { bold: true, size: 9 });
  // Ruang membubuhkan tanda tangan & cap basah.
  for (let i = 0; i < 4; i++) ws.addRow([]).height = 15;

  const garisTtd = "( ……………………………………… )";
  const nama = (n: string | null) => (n ? `( ${n} )` : garisTtd);
  const barisNama = tulis(pihak.map((p) => nama(p.slot.nama)), {
    bold: true,
    size: 9,
    garisAtas: true,
  }).number;
  // Jabatan di bawah nama penyedia mengikuti ORANG yang meneken – dulu selalu
  // jabatan direktur, jadi laporan mingguan mencetak nama pelaksana di bawah
  // jabatan direktur (DECISIONS 662).
  tulis(pihak.map((p) => p.slot.sub), { size: 8, color: WARNA.teksRedup });
  if (o.gambar) {
    // Pihaknya dibawa DATA, bukan urutan larik (DECISIONS 328): kkp = PPK/Wakil
    // Sah, konsultan = pengawas, penyedia = penyedia – sama dengan `muatTtdPdf`.
    tempelTtdXlsx(ws, {
      blok: blok.map(([a, b], i) => ({ kolomKiri: a, kolomKanan: b, berkas: pihak[i]!.gambar ?? { ttd: null, stempel: null } })),
      rowNama: barisNama,
      rowAtasBlok: barisAtas,
    });
  }
}
