import { z } from "zod";

/**
 * IMPOR LAPORAN HARIAN PELAKSANA (DECISIONS 733) – bentuk data yang dibaca.
 *
 * Permintaan user 2026-11-01: *"ada beberapa pelaksana sudah buat laporan
 * harian sendiri, ini jadi problem karena harus double input ulang ke marlin.
 * aku ingin kamu bisa membaca beberapa format … lalu kamu proses ke draft
 * untuk laporan harian di hari itu"*.
 *
 * Hasil bacaan BUKAN angka resmi: ia hanya mengisi pratinjau. Yang masuk draft
 * adalah yang dipilih orangnya, lewat layanan laporan harian biasa (penjaga
 * sisa RAB, nilai, audit) – sama dengan input manual.
 */

/** Satu potong teks PDF beserta letaknya (titik PDF, y dari ATAS halaman). */
export type PotongTeks = { s: string; x: number; y: number; w: number };

export const pekerjaanDibacaSchema = z.object({
  no: z.string().nullable(),
  uraian: z.string(),
  /** Volume yang dikerjakan HARI ITU, apa adanya dari berkas. */
  volume: z.number().nullable(),
  satuan: z.string().nullable(),
  /** Kolom "VOL RENCANA" bila ada – rujukan, tidak dipakai menghitung. */
  volumeRencana: z.number().nullable(),
  catatan: z.string().nullable(),
});

export const tenagaDibacaSchema = z.object({
  jabatan: z.string(),
  pagi: z.number().nullable(),
  siang: z.number().nullable(),
});

export const bahanDibacaSchema = z.object({
  nama: z.string(),
  merk: z.string().nullable(),
  /** Teks kolom volume diterima apa adanya, mis. "1 Unit", "50 Ujg", "✓". */
  teksTerima: z.string().nullable(),
  /** Teks kolom volume ditolak – barang ditolak tidak dihitung masuk. */
  teksTolak: z.string().nullable(),
});

export const bacaanLaporanSchema = z.object({
  tanggalTeks: z.string().nullable(),
  hariTeks: z.string().nullable(),
  lokasiTeks: z.string().nullable(),
  /** Tahun anggaran ("T. A.") – cadangan tahun bila tanggal ditulis tanpa tahun. */
  tahunAnggaran: z.number().nullable(),
  pekerjaan: z.array(pekerjaanDibacaSchema),
  tenaga: z.array(tenagaDibacaSchema),
  bahan: z.array(bahanDibacaSchema),
});

export type PekerjaanDibaca = z.infer<typeof pekerjaanDibacaSchema>;
export type TenagaDibaca = z.infer<typeof tenagaDibacaSchema>;
export type BahanDibaca = z.infer<typeof bahanDibacaSchema>;

/** Hasil baca + dari mana ia dibaca + catatan pembacaan (disebut di pratinjau). */
export type BacaanLaporan = z.infer<typeof bacaanLaporanSchema> & {
  sumber: "templat_kkp" | "ai";
  catatanBaca: string[];
};
