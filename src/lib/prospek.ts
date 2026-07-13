import type { DocumentType, ProspekStage, UserRole } from "@prisma/client";

/**
 * Tahap prospek DITENTUKAN OTOMATIS dari dokumen yang sudah diunggah — bukan
 * dipilih manual. Sistem baca tipe dokumen → tahap terjauh yang tercapai.
 */
const STAGE_MARKERS: { stage: ProspekStage; types: DocumentType[] }[] = [
  { stage: "penetapan", types: ["penetapan_pemenang", "sppbj"] },
  { stage: "negosiasi", types: ["ba_negosiasi", "ba_klarifikasi"] },
  { stage: "penawaran", types: ["penawaran"] },
  { stage: "undangan", types: ["undangan", "ba_penjelasan"] },
];

export function deriveStageFromDocs(types: DocumentType[]): ProspekStage {
  const set = new Set(types);
  for (const m of STAGE_MARKERS) {
    if (m.types.some((t) => set.has(t))) return m.stage;
  }
  return "identifikasi";
}

/** Tipe dokumen yang menandai satu tahap tercapai (untuk indikator stepper). */
export const STAGE_DOC_HINT: Record<ProspekStage, string> = {
  identifikasi: "—",
  undangan: "Undangan / BA Penjelasan (aanwijzing)",
  penawaran: "Dokumen Penawaran",
  negosiasi: "BA Negosiasi / Klarifikasi",
  penetapan: "SPPBJ / Penetapan Pemenang",
  jadi_kontrak: "Kontrak",
  batal: "—",
};

/** Tahap prospek (tender) — urut pipeline. */
export const PROSPEK_STAGE_ORDER: ProspekStage[] = [
  "identifikasi",
  "undangan",
  "penawaran",
  "negosiasi",
  "penetapan",
  "jadi_kontrak",
  "batal",
];

/** Tahap aktif (belum terminal) — untuk funnel & aksi. */
export const PROSPEK_ACTIVE_STAGES: ProspekStage[] = [
  "identifikasi",
  "undangan",
  "penawaran",
  "negosiasi",
  "penetapan",
];

export const PROSPEK_STAGE_LABEL: Record<ProspekStage, string> = {
  identifikasi: "Identifikasi",
  undangan: "Undangan",
  penawaran: "Penawaran",
  negosiasi: "Negosiasi",
  penetapan: "Penetapan / SPPBJ",
  jadi_kontrak: "Jadi Kontrak",
  batal: "Batal",
};

export const PROSPEK_STAGE_CLASS: Record<ProspekStage, string> = {
  identifikasi: "bg-slate-100 text-slate-600",
  undangan: "bg-blue-50 text-blue-700",
  penawaran: "bg-blue-50 text-blue-700",
  negosiasi: "bg-amber-50 text-amber-700",
  penetapan: "bg-indigo-50 text-indigo-700",
  jadi_kontrak: "bg-green-50 text-green-700",
  batal: "bg-red-50 text-red-700",
};

/** Role yang boleh kelola pengadaan/prospek. */
export function canManageProspek(role: UserRole): boolean {
  return role === "super_admin" || role === "program_director";
}

/** slug URL-safe dari nama (unik ditangani pemanggil). */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "lokasi";
}
