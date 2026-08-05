import type { IssueSeverity, IssueStatus, RecoveryStatus } from "@/generated/prisma/enums";
import type { BadgeTone } from "@/components/ui";

/** Label + tone badge kendala/pemulihan — satu tempat, dipakai server & client. */

export const ISSUE_SEVERITY_LABEL: Record<IssueSeverity, string> = {
  rendah: "Rendah",
  sedang: "Sedang",
  tinggi: "Tinggi",
  kritis: "Kritis",
};

export const ISSUE_SEVERITY_TONE: Record<IssueSeverity, BadgeTone> = {
  rendah: "neutral",
  sedang: "info",
  tinggi: "warning",
  kritis: "danger",
};

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  terbuka: "Terbuka",
  ditangani: "Ditangani",
  selesai: "Selesai",
};

export const ISSUE_STATUS_TONE: Record<IssueStatus, BadgeTone> = {
  terbuka: "danger",
  ditangani: "warning",
  selesai: "success",
};

export const RECOVERY_STATUS_LABEL: Record<RecoveryStatus, string> = {
  direncanakan: "Direncanakan",
  berjalan: "Berjalan",
  selesai: "Selesai",
  batal: "Batal",
};

export const RECOVERY_STATUS_TONE: Record<RecoveryStatus, BadgeTone> = {
  direncanakan: "neutral",
  berjalan: "info",
  selesai: "success",
  batal: "danger",
};

export const ALL_ISSUE_SEVERITIES = Object.keys(ISSUE_SEVERITY_LABEL) as IssueSeverity[];
export const ALL_ISSUE_STATUSES = Object.keys(ISSUE_STATUS_LABEL) as IssueStatus[];
export const ALL_RECOVERY_STATUSES = Object.keys(RECOVERY_STATUS_LABEL) as RecoveryStatus[];
