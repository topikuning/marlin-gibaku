/**
 * Bentuk hasil pencarian global — tipe + label saja, TANPA akses database.
 *
 * Sengaja dipisah dari `search-action.ts`: berkas beranotasi `"use server"`
 * hanya boleh mengekspor fungsi async, jadi label dan tipe tidak bisa tinggal
 * di sana. Memisahnya juga berarti komponen klien (`shell/global-search.tsx`)
 * dapat mengimpor label tanpa ikut menarik Prisma ke bundel peramban.
 */

export type JenisHasil = "lokasi" | "paket" | "dokumen" | "pengguna";

export type HasilCari = {
  key: string;
  jenis: JenisHasil;
  judul: string;
  /** Konteks satu baris supaya nama yang mirip bisa dibedakan. */
  detail: string;
  href: string;
};

export const LABEL_JENIS_HASIL: Record<JenisHasil, string> = {
  lokasi: "Lokasi",
  paket: "Paket",
  dokumen: "Dokumen",
  pengguna: "Pengguna",
};

/** Panjang minimum sebelum query ditembak — 1 huruf cocok dengan hampir semua. */
export const MIN_HURUF_CARI = 2;
