import type { UserRole } from "@/generated/prisma/enums";

/**
 * Otorisasi capability-based. Sumber: docs/rebuild/PERMISSION_MATRIX.md.
 * Frontend hanya menyembunyikan menu; setiap Server Action / Route Handler
 * WAJIB memanggil requireCapability / requireLocationAccess lagi.
 */

export const CAPABILITIES = [
  "portfolio.view",
  "package.view",
  "package.create",
  "package.edit",
  "prospect.manage",
  "contract.manage",
  "amendment.manage",
  "location.view",
  "location.manage",
  "rab.view",
  "rab.manage",
  "baseline.manage",
  "weekly_plan.manage",
  "daily_report.create",
  "daily_report.review",
  "daily_report.finalize",
  "field_activity.manage",
  "progress.view",
  "issue.manage",
  "finance.view",
  "finance.input",
  "finance.approve",
  "document.view",
  "document.upload",
  "document.verify",
  "compliance.manage",
  "report.export",
  "user.manage",
  "user.create",
  "system.manage",
  "audit.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const VIEW_ALL: Capability[] = [
  "location.view",
  "rab.view",
  "progress.view",
  "document.view",
];

export const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<Capability>> = {
  super_admin: new Set<Capability>(CAPABILITIES),
  program_director: new Set<Capability>(
    CAPABILITIES.filter((c) => c !== "system.manage"),
  ),
  regional_manager: new Set<Capability>([
    ...VIEW_ALL,
    "portfolio.view",
    "package.view",
    "location.manage",
    "weekly_plan.manage",
    "issue.manage",
    "field_activity.manage",
    "finance.view",
    "finance.approve",
    "document.upload",
    "document.verify",
    "compliance.manage",
    "report.export",
  ]),
  project_manager: new Set<Capability>([
    ...VIEW_ALL,
    "portfolio.view",
    "package.view",
    "location.manage",
    "rab.manage",
    "baseline.manage",
    "weekly_plan.manage",
    "daily_report.review",
    "field_activity.manage",
    "issue.manage",
    "finance.view",
    "finance.input",
    "document.upload",
    "document.verify",
    "compliance.manage",
    "report.export",
    "user.create", // bikin Site Manager & Mandor di bawahnya
  ]),
  site_manager: new Set<Capability>([
    ...VIEW_ALL,
    "package.view",
    "weekly_plan.manage",
    "daily_report.create",
    "daily_report.review",
    "daily_report.finalize",
    "field_activity.manage",
    "issue.manage",
    "finance.input",
    "document.upload",
    "report.export",
    "user.create", // bikin Mandor di bawahnya
  ]),
  field_supervisor: new Set<Capability>([
    ...VIEW_ALL,
    "daily_report.create",
    "field_activity.manage",
  ]),
  exec_viewer: new Set<Capability>([
    ...VIEW_ALL,
    "portfolio.view",
    "package.view",
    "finance.view",
    "report.export",
  ]),
};

/** Role yang melihat semua lokasi tanpa penugasan. */
export const CROSS_LOCATION_ROLES: ReadonlySet<UserRole> = new Set([
  "super_admin",
  "program_director",
  "exec_viewer",
]);

export function can(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function isCrossLocation(role: UserRole): boolean {
  return CROSS_LOCATION_ROLES.has(role);
}

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super Admin",
  program_director: "Program Director",
  regional_manager: "Area Manager",
  project_manager: "Project Manager",
  site_manager: "Site Manager",
  field_supervisor: "Mandor",
  exec_viewer: "Exec Viewer (KKP)",
};

export const ALL_ROLES = Object.keys(ROLE_LABEL) as UserRole[];

/**
 * Pembuatan user BERJENJANG: siapa boleh membuat akun peran apa.
 * PM boleh bikin Site Manager & Mandor; Site Manager boleh bikin Mandor.
 * Peran manajemen penuh (super_admin/program_director) boleh membuat semua.
 * Selalu dicatat createdById agar tahu pembuatnya.
 */
const ROLE_CREATE_MATRIX: Partial<Record<UserRole, UserRole[]>> = {
  super_admin: ALL_ROLES,
  program_director: ALL_ROLES.filter((r) => r !== "super_admin"),
  project_manager: ["site_manager", "field_supervisor"],
  site_manager: ["field_supervisor"],
};

/** Daftar peran yang boleh dibuat oleh `role` (kosong = tidak boleh membuat user). */
export function creatableRoles(role: UserRole): UserRole[] {
  return ROLE_CREATE_MATRIX[role] ?? [];
}

/** Apakah `actorRole` boleh membuat akun ber-peran `targetRole`. */
export function canCreateRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return creatableRoles(actorRole).includes(targetRole);
}
