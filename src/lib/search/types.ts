/**
 * Bentuk hasil pencarian global — TANPA `server-only`, karena panel pencarian
 * adalah komponen client dan ikut memakai tipe + label ini. Kuerinya sendiri
 * (yang menyentuh DB dan menyaring capability/scope) ada di `./global`.
 */

export type SearchKind = "paket" | "lokasi" | "vendor" | "dokumen" | "pengguna";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  /** Judul utama hasil. */
  label: string;
  /** Baris kedua: konteks yang membedakan dua hasil bernama mirip. */
  detail: string;
  href: string;
};

export const KIND_LABEL: Record<SearchKind, string> = {
  paket: "Paket",
  lokasi: "Lokasi",
  vendor: "Perusahaan & Vendor",
  dokumen: "Dokumen",
  pengguna: "Pengguna",
};

/** Urutan tampil: objek pekerjaan dulu, data referensi belakangan. */
export const KIND_ORDER: SearchKind[] = ["paket", "lokasi", "dokumen", "vendor", "pengguna"];

/** Kueri lebih pendek dari ini mencocokkan hampir semua baris — bukan pencarian. */
export const MIN_QUERY = 2;
