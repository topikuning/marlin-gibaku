import type { UserRole, ReportItemState } from "@prisma/client";

/** Role yang boleh input laporan (draft). */
export const REPORTER_ROLES: UserRole[] = ["site_manager", "field_supervisor"];

/** Role yang boleh approve/reject draft laporan (DECISIONS 018: SM accountable). */
export const APPROVER_ROLES: UserRole[] = [
  "site_manager",
  "super_admin",
  "program_director",
];

export function canReport(role: UserRole): boolean {
  return REPORTER_ROLES.includes(role);
}
export function canApprove(role: UserRole): boolean {
  return APPROVER_ROLES.includes(role);
}

export const REPORT_STATE_LABEL: Record<ReportItemState, string> = {
  draft_mandor: "Draft (mandor)",
  draft_sm: "Draft (SM)",
  approved: "Disetujui",
  sent: "Terkirim",
  rejected: "Ditolak",
};

export const REPORT_STATE_CLASS: Record<ReportItemState, string> = {
  draft_mandor: "bg-[#FBF0DA] text-[#946A00]",
  draft_sm: "bg-[#FBF0DA] text-[#946A00]",
  approved: "bg-[#E4F0E8] text-[#2E7D4F]",
  sent: "bg-[#E4F0E8] text-[#2E7D4F]",
  rejected: "bg-[#FCE8E4] text-[#C1442E]",
};

/** State draft yang masih menunggu review SM. */
export const PENDING_STATES: ReportItemState[] = ["draft_mandor", "draft_sm"];
