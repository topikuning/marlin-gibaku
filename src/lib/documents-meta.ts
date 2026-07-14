import type { AdminPhase, DocumentType } from "@/generated/prisma/enums";

/**
 * Metadata dokumen yang AMAN untuk client component (tanpa import server).
 * Logika upload/list ada di src/lib/documents.ts (server-only).
 */

// ─── Label & urutan (UI Bahasa Indonesia) ────────────────────────────

export const PHASE_ORDER: AdminPhase[] = [
  "pemilihan",
  "penunjukan",
  "kontrak",
  "mulai_kerja",
  "pelaksanaan",
  "adendum",
  "serah_terima",
  "pembayaran",
  "lainnya",
];

export const PHASE_LABEL: Record<AdminPhase, string> = {
  pemilihan: "Pemilihan / Tender",
  penunjukan: "Penunjukan (SPPBJ)",
  kontrak: "Kontrak",
  mulai_kerja: "Mulai Kerja (SPMK)",
  pelaksanaan: "Pelaksanaan",
  adendum: "Adendum / CCO",
  serah_terima: "Serah Terima (BAST)",
  pembayaran: "Pembayaran",
  lainnya: "Lainnya",
};

export const TYPE_LABEL: Record<DocumentType, string> = {
  undangan: "Undangan / Pengumuman",
  ba_penjelasan: "BA Pemberian Penjelasan (Aanwijzing)",
  penawaran: "Dokumen Penawaran",
  ba_evaluasi: "BA Evaluasi",
  ba_klarifikasi: "BA Klarifikasi & Pembuktian",
  ba_negosiasi: "BA Negosiasi",
  penetapan_pemenang: "Penetapan Pemenang",
  sanggah: "Sanggah / Jawaban Sanggah",
  sppbj: "SPPBJ",
  kontrak: "Kontrak / Surat Perjanjian",
  jaminan: "Jaminan (Pelaksanaan / Uang Muka)",
  spmk: "SPMK",
  ba_serah_terima_lapangan: "BA Serah Terima Lapangan",
  pcm: "PCM (Pre-Construction Meeting)",
  mc0: "MC-0 (Mutual Check 0%)",
  laporan: "Laporan (harian/mingguan/bulanan)",
  mc_berkala: "MC Berkala / BA Opname",
  adendum: "Adendum / CCO",
  surat_kendala: "Surat Kendala Lapangan",
  surat_peringatan: "Surat Peringatan (SP)",
  bast_pho: "BAST-1 / PHO",
  bast_fho: "BAST-2 / FHO",
  ba_pembayaran: "BA Pembayaran",
  invoice: "Invoice / Kwitansi",
  faktur_pajak: "Faktur Pajak",
  hps: "HPS (Harga Perkiraan Sendiri)",
  lainnya: "Lainnya",
};

export const ALL_PHASES = Object.keys(PHASE_LABEL) as AdminPhase[];
export const ALL_DOC_TYPES = Object.keys(TYPE_LABEL) as DocumentType[];

/** Jenis dokumen yang relevan per fase (untuk dropdown dependen). */
export const TYPES_BY_PHASE: Record<AdminPhase, DocumentType[]> = {
  pemilihan: ["hps", "undangan", "ba_penjelasan", "penawaran", "ba_evaluasi", "ba_klarifikasi", "ba_negosiasi", "lainnya"],
  penunjukan: ["penetapan_pemenang", "sanggah", "sppbj", "jaminan", "lainnya"],
  kontrak: ["undangan", "kontrak", "jaminan", "lainnya"],
  mulai_kerja: ["undangan", "spmk", "ba_serah_terima_lapangan", "pcm", "mc0", "lainnya"],
  pelaksanaan: ["laporan", "mc_berkala", "surat_kendala", "surat_peringatan", "lainnya"],
  adendum: ["undangan", "adendum", "jaminan", "lainnya"],
  serah_terima: ["bast_pho", "bast_fho", "lainnya"],
  pembayaran: ["laporan", "ba_pembayaran", "invoice", "faktur_pajak", "lainnya"],
  lainnya: ALL_DOC_TYPES,
};

// ─── Validasi file ───────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

/** Mime yang diterima → label pendek untuk pesan error/UI. */
export const ALLOWED_UPLOAD_MIMES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};

