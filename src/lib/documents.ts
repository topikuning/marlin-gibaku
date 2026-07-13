import type { UserRole, DocumentStage, DocumentType } from "@prisma/client";

/** Role yang boleh unggah/kelola dokumen (mandor & exec_viewer tidak). */
export const DOC_MANAGER_ROLES: UserRole[] = [
  "super_admin",
  "program_director",
  "regional_manager",
  "project_manager",
  "site_manager",
];

export function canManageDocuments(role: UserRole): boolean {
  return DOC_MANAGER_ROLES.includes(role);
}

export const STAGE_ORDER: DocumentStage[] = [
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

/**
 * Tahap paket SAAT INI = tahap dokumen terjauh yang sudah diunggah (dibaca dari
 * dokumen, bukan di-set manual). "lainnya" diabaikan. Null kalau belum ada dokumen.
 */
export function deriveDocStage(stages: DocumentStage[]): DocumentStage | null {
  const rank = (s: DocumentStage) => STAGE_ORDER.indexOf(s);
  let best: DocumentStage | null = null;
  for (const s of stages) {
    if (s === "lainnya") continue;
    if (best === null || rank(s) > rank(best)) best = s;
  }
  return best;
}

export const STAGE_LABEL: Record<DocumentStage, string> = {
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
  lainnya: "Lainnya",
};

/** Jenis dokumen yang relevan per tahap (untuk dropdown dependen). */
export const TYPES_BY_STAGE: Record<DocumentStage, DocumentType[]> = {
  pemilihan: ["undangan", "ba_penjelasan", "penawaran", "ba_evaluasi", "ba_klarifikasi", "ba_negosiasi", "lainnya"],
  penunjukan: ["penetapan_pemenang", "sanggah", "sppbj", "lainnya"],
  kontrak: ["kontrak", "jaminan", "lainnya"],
  mulai_kerja: ["spmk", "ba_serah_terima_lapangan", "pcm", "mc0", "lainnya"],
  pelaksanaan: ["laporan", "mc_berkala", "surat_kendala", "surat_peringatan", "lainnya"],
  adendum: ["adendum", "lainnya"],
  serah_terima: ["bast_pho", "bast_fho", "lainnya"],
  pembayaran: ["ba_pembayaran", "invoice", "faktur_pajak", "lainnya"],
  lainnya: ["lainnya"],
};
