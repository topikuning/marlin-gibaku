import type {
  DailyReportStatus,
  LocationStatus,
  PackageStage,
} from "@/generated/prisma/enums";

/**
 * Mesin transisi status canonical (docs/rebuild/BUSINESS_LIFECYCLE.md).
 * Pure — dipakai server action (validasi) + unit test.
 */

export const PACKAGE_STAGE_ORDER: PackageStage[] = [
  "prospek",
  "tender",
  "penetapan",
  "kontrak",
  "pelaksanaan",
  "serah_terima",
  "selesai",
];

const PACKAGE_TRANSITIONS: Record<PackageStage, PackageStage[]> = {
  prospek: ["tender", "batal"],
  tender: ["penetapan", "batal"],
  penetapan: ["kontrak", "batal"],
  kontrak: ["pelaksanaan", "batal"],
  pelaksanaan: ["serah_terima"],
  serah_terima: ["selesai"],
  selesai: [],
  batal: [],
};

const LOCATION_TRANSITIONS: Record<LocationStatus, LocationStatus[]> = {
  persiapan: ["berjalan", "batal"],
  berjalan: ["terhenti", "selesai", "batal"],
  terhenti: ["berjalan", "batal"],
  selesai: ["pho"],
  pho: ["pemeliharaan"],
  pemeliharaan: ["fho"],
  fho: [],
  batal: [],
};

const REPORT_TRANSITIONS: Record<DailyReportStatus, DailyReportStatus[]> = {
  draft: ["dikirim"],
  dikirim: ["perlu_koreksi", "disetujui"],
  perlu_koreksi: ["dikirim"],
  disetujui: ["final", "perlu_koreksi"],
  final: [],
};

export function canTransitionPackage(from: PackageStage, to: PackageStage): boolean {
  return PACKAGE_TRANSITIONS[from].includes(to);
}

export function canTransitionLocation(from: LocationStatus, to: LocationStatus): boolean {
  return LOCATION_TRANSITIONS[from].includes(to);
}

export function canTransitionReport(from: DailyReportStatus, to: DailyReportStatus): boolean {
  return REPORT_TRANSITIONS[from].includes(to);
}

export const PACKAGE_STAGE_LABEL: Record<PackageStage, string> = {
  prospek: "Prospek",
  tender: "Tender",
  penetapan: "Penetapan",
  kontrak: "Kontrak",
  pelaksanaan: "Pelaksanaan",
  serah_terima: "Serah Terima",
  selesai: "Selesai",
  batal: "Batal",
};

export const LOCATION_STATUS_LABEL: Record<LocationStatus, string> = {
  persiapan: "Persiapan",
  berjalan: "Berjalan",
  terhenti: "Terhenti",
  selesai: "Selesai Fisik",
  pho: "PHO",
  pemeliharaan: "Pemeliharaan",
  fho: "FHO",
  batal: "Batal",
};

export const REPORT_STATUS_LABEL: Record<DailyReportStatus, string> = {
  draft: "Draft",
  dikirim: "Dikirim",
  perlu_koreksi: "Perlu Koreksi",
  disetujui: "Disetujui",
  final: "Final",
};

/** Tone badge per status — dipakai StatusPill (satu tempat, tidak tersebar). */
export const REPORT_STATUS_TONE: Record<DailyReportStatus, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral",
  dikirim: "info",
  perlu_koreksi: "warning",
  disetujui: "success",
  final: "success",
};

export const PACKAGE_STAGE_TONE: Record<PackageStage, "neutral" | "info" | "warning" | "success" | "danger"> = {
  prospek: "neutral",
  tender: "info",
  penetapan: "info",
  kontrak: "info",
  pelaksanaan: "warning",
  serah_terima: "info",
  selesai: "success",
  batal: "danger",
};

export const LOCATION_STATUS_TONE: Record<LocationStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  persiapan: "neutral",
  berjalan: "info",
  terhenti: "warning",
  selesai: "success",
  pho: "success",
  pemeliharaan: "info",
  fho: "success",
  batal: "danger",
};
