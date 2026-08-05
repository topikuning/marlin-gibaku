import type { ImportKind, ImportStatus } from "@/generated/prisma/enums";

/**
 * Bagian jejak impor yang MURNI: label, tone, dan aturan status.
 *
 * Sengaja terpisah dari `queries.ts`/`record.ts`, yang keduanya mengimpor `db`
 * dan karenanya ikut memuat `env` — modul yang menolak dimuat tanpa
 * DATABASE_URL. Aturan status adalah bagian yang paling perlu diuji, dan uji
 * unit tidak punya database. Kalau ia ikut tinggal di sana, satu-satunya cara
 * mengujinya adalah menyalin ulang aturannya ke dalam uji — dan uji yang
 * menyalin implementasinya tidak menguji apa pun.
 */

export const LABEL_JENIS_IMPOR: Record<ImportKind, string> = {
  rab: "RAB / HPS",
  jadwal: "Jadwal (kurva-S)",
  master_lokasi: "Master lokasi",
  laporan_harian: "Laporan harian",
  dokumen_drive: "Dokumen (Google Drive)",
};

export const LABEL_STATUS_IMPOR: Record<ImportStatus, string> = {
  diproses: "Diproses",
  berhasil: "Berhasil",
  sebagian: "Sebagian ditolak",
  gagal: "Gagal",
};

export const TONE_STATUS_IMPOR: Record<ImportStatus, "neutral" | "success" | "warning" | "danger"> = {
  diproses: "neutral",
  berhasil: "success",
  sebagian: "warning",
  gagal: "danger",
};

/**
 * Status DITURUNKAN dari hitungan baris, tidak pernah diminta dari pemanggil.
 *
 * Kalau pemanggil yang menentukan, cepat atau lambat akan ada impor berlabel
 * "berhasil" yang berdampingan dengan ratusan baris tertolak — dan label itulah
 * yang dibaca orang, bukan angkanya.
 */
export function statusDari(read: number, accepted: number, rejected: number): ImportStatus {
  if (accepted === 0 && (rejected > 0 || read > 0)) return "gagal";
  if (rejected > 0) return "sebagian";
  return "berhasil";
}

export type BarisImpor = {
  id: string;
  kind: ImportKind;
  status: ImportStatus;
  fileName: string;
  fileBytes: number;
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  message: string | null;
  startedAt: Date;
  olehNama: string | null;
  lokasiNama: string | null;
  jumlahMasalah: number;
};

/** Ringkasan untuk KPI: berapa impor, berapa yang tidak mulus. */
export function ringkasImpor(rows: BarisImpor[]) {
  return {
    total: rows.length,
    bermasalah: rows.filter((r) => r.status === "sebagian" || r.status === "gagal").length,
    barisTertolak: rows.reduce((s, r) => s + r.rowsRejected, 0),
    barisDiterima: rows.reduce((s, r) => s + r.rowsAccepted, 0),
  };
}
