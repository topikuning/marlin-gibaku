import type { UserRole, LocationStatus } from "@prisma/client";

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super Admin",
  program_director: "Program Director",
  regional_manager: "Regional Manager",
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
  planning: "bg-[#EEF2F6] text-[#3A4E63]",
  in_progress: "bg-[#E4F0E8] text-[#2E7D4F]",
  paused: "bg-[#FBF0DA] text-[#946A00]",
  completed: "bg-[#E4F0E8] text-[#2E7D4F]",
  handed_over: "bg-[#EDE7F6] text-[#5B4B8A]",
  cancelled: "bg-[#FCE8E4] text-[#C1442E]",
};
