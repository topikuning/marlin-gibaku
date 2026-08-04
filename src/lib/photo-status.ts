import type { DailyReportStatus, FieldActivityStatus } from "@/generated/prisma/enums";

/**
 * STATUS FOTO = TURUNAN dari laporan/kegiatan pemiliknya, bukan kolom sendiri.
 *
 * Keluhan user 2026-08-04: *"semua foto menunggu review, padahal laporan sudah
 * difinalkan."* Penyebabnya: `Photo.verification` HANYA pernah ditulis sekali,
 * yaitu `pending` saat unggah. Tidak ada aksi, UI, maupun capability yang
 * menaikkannya — jadi "Terverifikasi" secara struktural selalu 0, dan badge di
 * galeri adalah antarmuka untuk alur kerja yang tidak pernah dibangun.
 *
 * Keputusan user: status foto MENGIKUTI induknya (DECISIONS 250). Alasannya
 * sejalan dengan aturan repo — status hanya berubah lewat mesin transisi
 * (`lifecycle.ts`), dan angka turunan tidak boleh disimpan sebagai kolom yang
 * bisa menyimpang dari sumbernya. Foto adalah LAMPIRAN laporan; ia tidak punya
 * siklus persetujuan sendiri, jadi memberinya kolom status sendiri hanya
 * menciptakan dua kebenaran yang bisa berbeda.
 *
 * GPS SENGAJA BUKAN BAGIAN DARI STATUS INI. Keduanya sumbu berbeda: status
 * menjawab "sudah disetujui atau belum", GPS menjawab "posisinya terbukti atau
 * tidak". Menggabungkannya membuat 96% foto (yang koordinatnya cadangan titik
 * proyek, DECISIONS 197) tidak pernah bisa berstatus apa pun selain bermasalah,
 * padahal laporannya sah. Penyaring GPS berdiri sendiri di galeri.
 */

export type PhotoStatus =
  | "terverifikasi"
  | "menunggu_review"
  | "perlu_koreksi"
  | "draft"
  | "lepas";

export type PhotoStatusTone = "success" | "info" | "warning" | "neutral";

export const PHOTO_STATUS_LABEL: Record<PhotoStatus, string> = {
  terverifikasi: "Terverifikasi",
  menunggu_review: "Menunggu Review",
  perlu_koreksi: "Perlu Koreksi",
  draft: "Draft",
  // Foto tanpa laporan maupun kegiatan. Tidak seharusnya ada; kalau muncul,
  // itu data yatim yang perlu ditelusuri — bukan disamarkan jadi "Draft".
  lepas: "Tanpa Induk",
};

export const PHOTO_STATUS_TONE: Record<PhotoStatus, PhotoStatusTone> = {
  terverifikasi: "success",
  menunggu_review: "info",
  perlu_koreksi: "warning",
  draft: "neutral",
  lepas: "warning",
};

/** Urutan chip filter di galeri — sengaja dari yang paling sering dicari. */
export const PHOTO_STATUS_ORDER: PhotoStatus[] = [
  "menunggu_review",
  "terverifikasi",
  "perlu_koreksi",
  "draft",
];

/**
 * Status laporan harian yang berarti fotonya sudah lolos pemeriksaan.
 *
 * `disetujui` DAN `final` keduanya masuk: penyetujuan itulah momen seseorang
 * yang berwenang membaca laporan berikut lampirannya. `final` sesudahnya cuma
 * penguncian, jadi menunggu `final` saja akan menahan foto yang sebetulnya
 * sudah diperiksa.
 */
export const STATUS_LAPORAN_TERVERIFIKASI: DailyReportStatus[] = ["disetujui", "final"];

/** Kegiatan lapangan hanya punya draft → final; final = sudah dikunci pelapor. */
export const STATUS_KEGIATAN_TERVERIFIKASI: FieldActivityStatus[] = ["final"];

/**
 * Turunkan status foto dari induknya.
 *
 * Foto boleh menempel ke laporan harian ATAU kegiatan lapangan. Bila keduanya
 * ada (foto item laporan yang juga ditautkan ke kegiatan), LAPORAN yang
 * menentukan — ia punya siklus persetujuan berjenjang, sedangkan kegiatan hanya
 * draft/final.
 */
export function deriveStatusFoto(induk: {
  reportStatus?: DailyReportStatus | null;
  activityStatus?: FieldActivityStatus | null;
}): PhotoStatus {
  const r = induk.reportStatus;
  if (r) {
    if (STATUS_LAPORAN_TERVERIFIKASI.includes(r)) return "terverifikasi";
    if (r === "perlu_koreksi") return "perlu_koreksi";
    if (r === "dikirim") return "menunggu_review";
    return "draft";
  }
  const a = induk.activityStatus;
  if (a) return STATUS_KEGIATAN_TERVERIFIKASI.includes(a) ? "terverifikasi" : "draft";
  return "lepas";
}
