/**
 * Bentuk data impor REKAP HARIAN (DECISIONS 782). MURNI – dipakai server dan
 * layar (rencana dihitung ulang di layar tiap kali orang mengubah pilihan).
 */

/** Satu baris sheet REKAP HARIAN yang terlihat. */
export type BarisRekap = {
  excelRow: number;
  /** Isi kolom NO bila berupa kode pendek (I, 1, a); kosong bila sama dengan nama. */
  kode: string;
  nama: string;
  satuan: string | null;
  volumeKontrak: number | null;
  /** Baris judul/kelompok: tanpa satuan. */
  judul: boolean;
  /** Angka ≠ 0 di kolom tanggal TERLIHAT. */
  sel: { tanggal: string; volume: number; kolom: string }[];
};

export type RekapMatriks = {
  sheet: string;
  barisJudul: number;
  kolomTanggal: { kolom: number; huruf: string; tanggal: string }[];
  /** Tanggal kolom terlihat pertama, dan tanggal terakhir yang berisi angka. */
  awalPeriode: string;
  akhirPeriode: string | null;
  baris: BarisRekap[];
  /** Angka di kolom tanggal TERSEMBUNYI – tidak dibaca, disebut. */
  tersembunyi: { tanggal: string; sel: number }[];
  /** Baris tersembunyi yang berisi angka – tidak dibaca, disebut. */
  barisTersembunyi: number[];
  /** Teks (bukan angka) di sel tanggal – tidak dibaca, disebut. */
  teksDiSelTanggal: { excelRow: number; kolom: string; isi: string }[];
};

/** Node RAB aktif, urut seperti di RAB (sortOrder). */
export type NodeRab = {
  lineageKey: string;
  kind: string;
  name: string;
  unit: string | null;
  volume: number | null;
  /** Item pekerjaan tanpa rincian – yang bisa menerima laporan. */
  daun: boolean;
  /** "II · 3 · 1" untuk ditampilkan. */
  jalur: string;
};

export type Cocok =
  | { lineageKey: string; cara: "urutan" | "nama" | "pilihan" }
  | { lineageKey: null; sebab: string; kandidat: string[] };

/** Baris laporan yang sudah ada di MARLIN untuk satu (item, tanggal). */
export type SelMarlin = {
  rowId: string;
  reportId: string;
  status: string;
  basis: string;
  volume: number;
  /** Baris hasil pemasangan sesudah aktivasi (777) – tidak disentuh impor. */
  padanan: boolean;
  foto: number;
};

export type LaporanMarlin = { reportId: string; status: string; noActivity: boolean };

export type ModeImpor = "tambah" | "timpa";

/** Keputusan untuk item yang bentrok. */
export type PilihanBentrok = "lewati" | "excel" | "jumlahkan" | "potong";
