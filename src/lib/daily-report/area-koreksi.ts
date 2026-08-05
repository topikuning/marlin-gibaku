import type { CorrectionArea } from "@/generated/prisma/enums";

/**
 * BAGIAN LAPORAN yang bisa diminta diperbaiki reviewer (DECISIONS 256).
 *
 * Sampai sekarang pengembalian laporan hanya membawa satu kalimat bebas, dan
 * kalimat itu tampil sebagai spanduk di puncak halaman — jauh dari hal yang
 * dimaksudnya. Mandor lalu menggulir seluruh editor sambil menebak bagian mana
 * yang dimaksud "cek ulang zona B".
 *
 * Daftar ini memakai nama BAGIAN LAYAR, bukan nama kolom database: yang
 * membacanya orang lapangan, dan "Volume pekerjaan" berarti sesuatu baginya
 * sementara `daily_report_items.volume` tidak.
 *
 * Sengaja pendek. Daftar panjang memaksa reviewer memilah-milah, dan yang
 * terjadi bukan ketelitian melainkan semua orang memilih "Lainnya".
 */
export const AREA_KOREKSI = [
  "volume",
  "foto",
  "cuaca",
  "tenaga_material",
  "kendala",
  "lainnya",
] as const satisfies readonly CorrectionArea[];

export const LABEL_AREA_KOREKSI: Record<CorrectionArea, string> = {
  volume: "Volume pekerjaan",
  foto: "Foto bukti",
  cuaca: "Cuaca & jam kerja",
  tenaga_material: "Tenaga & material",
  kendala: "Kendala",
  lainnya: "Lainnya",
};

/** Keterangan singkat di sebelah pilihan — supaya pilihannya tidak ditebak. */
export const ARTI_AREA_KOREKSI: Record<CorrectionArea, string> = {
  volume: "Angka volume item pekerjaan tidak cocok / salah ketik.",
  foto: "Foto kurang, tidak jelas, atau tidak sesuai pekerjaannya.",
  cuaca: "Cuaca per jam atau jam mulai–selesai perlu diperbaiki.",
  tenaga_material: "Jumlah tenaga kerja, material masuk, atau peralatan.",
  kendala: "Kendala lapangan belum dicatat atau kurang jelas.",
  lainnya: "Hal lain — dijelaskan di catatan.",
};
