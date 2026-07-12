import type { UserRole, ReportItemState } from "@prisma/client";

/** Role yang boleh input laporan (draft). Admin (super_admin/PD) juga bisa —
 * "admin handle semua" — mereka cross-location jadi boleh lapor lokasi manapun. */
export const REPORTER_ROLES: UserRole[] = [
  "site_manager",
  "field_supervisor",
  "super_admin",
  "program_director",
];

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
  draft_mandor: "bg-[#FEF3C7] text-[#B45309]",
  draft_sm: "bg-[#FEF3C7] text-[#B45309]",
  approved: "bg-[#DCFCE7] text-[#16A34A]",
  sent: "bg-[#DCFCE7] text-[#16A34A]",
  rejected: "bg-[#FEE2E2] text-[#DC2626]",
};

/** State draft yang masih menunggu review SM. */
export const PENDING_STATES: ReportItemState[] = ["draft_mandor", "draft_sm"];
