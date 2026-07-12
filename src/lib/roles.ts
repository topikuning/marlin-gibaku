import type { UserRole, LocationStatus } from "@prisma/client";

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super Admin",
  program_director: "Program Director",
  regional_manager: "Area Manager",
  project_manager: "Project Manager",
  site_manager: "Site Manager",
  field_supervisor: "Mandor (Field Supervisor)",
  exec_viewer: "Exec Viewer (KKP)",
};

/** Role yang aksesnya lintas-lokasi (lihat semua), tidak lewat assignment. */
export const CROSS_LOCATION_ROLES: UserRole[] = [
  "super_admin",
  "program_director",
  "exec_viewer",
];

export function isCrossLocation(role: UserRole): boolean {
  return CROSS_LOCATION_ROLES.includes(role);
}

/** Role yang boleh provisioning/kelola user. */
export const USER_ADMIN_ROLES: UserRole[] = ["super_admin", "program_director"];

export function canManageUsers(role: UserRole): boolean {
  return USER_ADMIN_ROLES.includes(role);
}

/** Role yang boleh lihat dashboard progress. */
export const DASHBOARD_ROLES: UserRole[] = [
  "super_admin",
  "program_director",
  "exec_viewer",
  "regional_manager",
  "project_manager",
];

export function canViewDashboard(role: UserRole): boolean {
  return DASHBOARD_ROLES.includes(role);
}

/** Semua role untuk dropdown (urut dari akses tertinggi). */
export const ALL_ROLES: UserRole[] = [
  "super_admin",
  "program_director",
  "regional_manager",
  "project_manager",
  "site_manager",
  "field_supervisor",
  "exec_viewer",
];

export const LOCATION_STATUS_LABEL: Record<LocationStatus, string> = {
  planning: "Perencanaan",
  in_progress: "Berjalan",
  paused: "Ditunda",
  completed: "Selesai",
  handed_over: "Serah Terima",
  cancelled: "Dibatalkan",
};

export const LOCATION_STATUS_CLASS: Record<LocationStatus, string> = {
  planning: "bg-[#EEF2F6] text-[#0F766E]",
  in_progress: "bg-[#DCFCE7] text-[#16A34A]",
  paused: "bg-[#FEF3C7] text-[#B45309]",
  completed: "bg-[#DCFCE7] text-[#16A34A]",
  handed_over: "bg-[#EDE9FE] text-[#7C3AED]",
  cancelled: "bg-[#FEE2E2] text-[#DC2626]",
};
