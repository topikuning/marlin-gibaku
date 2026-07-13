import type { DocumentType } from "@prisma/client";

/**
 * Alur Administrasi KNMP 2025 (dari format resmi KKP/DJPT).
 * Daur hidup dokumen satu paket pekerjaan, dari RAB HPS sampai serah terima.
 * Dipakai sebagai checklist kepatuhan per lokasi. `docType` (opsional) dipakai
 * untuk auto-deteksi status dari arsip Dokumen yang sudah diupload.
 */

export type Pic =
  | "PPK"
  | "Kontraktor"
  | "Pengawas"
  | "Koperasi"
  | "PPK-Kontraktor"
  | "PPK-Pengawas"
  | "Kontraktor-Pengawas"
  | "PPK-Kontraktor-Pengawas";

export const PIC_LABEL: Record<Pic, string> = {
  PPK: "PPK",
  Kontraktor: "Kontraktor",
  Pengawas: "Konsultan Pengawas",
  Koperasi: "Koperasi Desa",
  "PPK-Kontraktor": "PPK + Kontraktor",
  "PPK-Pengawas": "PPK + Pengawas",
  "Kontraktor-Pengawas": "Kontraktor + Pengawas",
  "PPK-Kontraktor-Pengawas": "PPK + Kontraktor + Pengawas",
};

export type FlowItem = {
  /** Nomor urut resmi di alur KKP. */
  no: string;
  label: string;
  pic: Pic;
  /** Kalau ada, status "sudah" dideteksi otomatis dari Dokumen bertipe ini. */
  docType?: DocumentType;
  /** Catatan kecil (opsional). */
  hint?: string;
};

export type FlowPhase = {
  key: string;
  title: string;
  items: FlowItem[];
};

export const KKP_ADMIN_FLOW: FlowPhase[] = [
  {
    key: "perencanaan",
    title: "1. Perencanaan & Persiapan",
    items: [
      { no: "1", label: "RAB HPS", pic: "PPK" },
      { no: "2", label: "DED (Detail Engineering Design)", pic: "PPK" },
      { no: "3", label: "RKS (Rencana Kerja & Syarat)", pic: "PPK" },
      { no: "4", label: "SMKK (Sistem Manajemen Keselamatan Konstruksi)", pic: "PPK" },
    ],
  },
  {
    key: "penunjukan",
    title: "2. Penunjukan & Kontrak",
    items: [
      { no: "5", label: "SPPBJ", pic: "PPK", docType: "sppbj" },
      { no: "6", label: "Pakta Integritas", pic: "Kontraktor" },
      { no: "7", label: "Jaminan Pelaksanaan", pic: "Kontraktor", docType: "jaminan" },
      { no: "8", label: "Keabsahan Jaminan Pelaksanaan", pic: "Kontraktor" },
      { no: "9", label: "Undangan Pembahasan & Penandatanganan Kontrak", pic: "PPK", docType: "undangan" },
      { no: "10", label: "Kontrak (Surat Perjanjian)", pic: "PPK-Kontraktor", docType: "kontrak" },
    ],
  },
  {
    key: "serah_lokasi",
    title: "3. Serah Terima Lokasi & Mulai Kerja",
    items: [
      { no: "12", label: "Undangan Peninjauan Lokasi Bersama", pic: "PPK", docType: "undangan" },
      { no: "11", label: "Surat Pernyataan Pemahaman Lokasi (Kontraktor)", pic: "Kontraktor" },
      { no: "13", label: "BA Serah Terima Lokasi + lampiran peninjauan", pic: "PPK-Kontraktor", docType: "ba_serah_terima_lapangan" },
      { no: "14", label: "SPMK (Surat Perintah Mulai Kerja)", pic: "PPK", docType: "spmk" },
    ],
  },
  {
    key: "pcm_mc0",
    title: "4. PCM & Mutual Check 0%",
    items: [
      { no: "15", label: "Undangan PCM", pic: "PPK", docType: "undangan" },
      { no: "16", label: "BA PCM (+ RMPK, RKK, dokumen pendukung)", pic: "PPK-Kontraktor", docType: "pcm" },
      { no: "17", label: "Surat Permohonan Kesiapan MC-0", pic: "Kontraktor" },
      { no: "18", label: "Undangan Pelaksanaan MC-0", pic: "PPK", docType: "undangan" },
      { no: "19", label: "BA Pemeriksaan Bersama (Kontraktor–Pengawas)", pic: "Kontraktor-Pengawas" },
      { no: "20", label: "Justifikasi Teknis Pengawas", pic: "Pengawas" },
      { no: "21", label: "Undangan Pembahasan MC-0", pic: "PPK", docType: "undangan" },
      { no: "22", label: "BA Pembahasan & Persetujuan MC-0", pic: "PPK-Kontraktor", docType: "mc0" },
    ],
  },
  {
    key: "cco",
    title: "5. Adendum / CCO (Contract Change Order)",
    items: [
      { no: "23", label: "Adendum 1 Kontrak", pic: "PPK-Kontraktor", docType: "adendum" },
      { no: "24", label: "Permohonan CCO (+ RAB & back-up perhitungan)", pic: "Kontraktor" },
      { no: "25", label: "BA Perhitungan Bersama (Kontraktor–Pengawas)", pic: "Kontraktor-Pengawas" },
      { no: "26", label: "Justifikasi Teknis Penambahan/Pengurangan", pic: "PPK-Pengawas" },
      { no: "27", label: "Undangan Pembahasan CCO", pic: "PPK-Kontraktor-Pengawas", docType: "undangan" },
      { no: "28", label: "BA Pembahasan CCO", pic: "PPK-Kontraktor-Pengawas" },
      { no: "29", label: "Persetujuan CCO (+ tambahan Jaminan Pelaksanaan bila naik)", pic: "PPK" },
      { no: "30", label: "Undangan Penandatanganan Adendum", pic: "PPK-Kontraktor", docType: "undangan" },
      { no: "31", label: "Adendum Surat Perjanjian (Kontrak)", pic: "PPK-Kontraktor", docType: "adendum" },
    ],
  },
  {
    key: "termin",
    title: "6. Termin & Pembayaran",
    items: [
      { no: "33", label: "BA Pembahasan Kemajuan Pekerjaan", pic: "PPK-Kontraktor-Pengawas" },
      { no: "33b", label: "Laporan Kemajuan Pekerjaan", pic: "Pengawas", docType: "laporan" },
      { no: "33c", label: "Permohonan Pemeriksaan Pekerjaan", pic: "Kontraktor" },
      { no: "33d", label: "BA Pemeriksaan Pekerjaan", pic: "PPK-Kontraktor" },
      { no: "33e", label: "BA Persetujuan Persentase Pekerjaan", pic: "PPK-Pengawas" },
      { no: "33f", label: "Surat Permohonan Pembayaran (+ kwitansi, e-faktur, NPWP)", pic: "Kontraktor", docType: "invoice" },
      { no: "33g", label: "Berita Acara Pembayaran (BAP)", pic: "PPK-Kontraktor", docType: "ba_pembayaran" },
    ],
  },
  {
    key: "scm",
    title: "7. Kontrak Kritis / SCM (bila terlambat)",
    items: [
      { no: "34", label: "Surat Peringatan Kontrak Kritis", pic: "PPK", docType: "surat_peringatan" },
      { no: "34b", label: "Undangan & BA Show Cause Meeting (SCM)", pic: "PPK-Kontraktor-Pengawas" },
      { no: "34c", label: "BA Pembuktian SCM", pic: "PPK-Kontraktor-Pengawas" },
      { no: "35", label: "Adendum Pemberian Kesempatan (bila diberikan)", pic: "PPK-Kontraktor", docType: "adendum" },
    ],
  },
  {
    key: "serah_terima",
    title: "8. Serah Terima Pekerjaan",
    items: [
      { no: "41", label: "Permohonan & BA Serah Terima Pertama (PHO)", pic: "Kontraktor" },
      { no: "42", label: "BAST-1 / PHO (Provisional Hand Over)", pic: "PPK-Kontraktor", docType: "bast_pho" },
      { no: "43", label: "BAST-2 / FHO (Final Hand Over)", pic: "PPK-Kontraktor", docType: "bast_fho" },
    ],
  },
];

export const FLOW_TOTAL = KKP_ADMIN_FLOW.reduce((n, p) => n + p.items.length, 0);
