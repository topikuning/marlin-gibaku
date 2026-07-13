import type { UserRole } from "@prisma/client";

export type NavItem = {
  href: string;
  label: string;
  /** false = halaman belum dibangun (tampil sebagai "segera", tidak diklik). */
  ready: boolean;
};

const DASHBOARD: UserRole[] = [
  "super_admin",
  "program_director",
  "exec_viewer",
  "regional_manager",
  "project_manager",
];
const ADMIN: UserRole[] = ["super_admin", "program_director"];
const REPORTER: UserRole[] = ["site_manager", "field_supervisor"];

/**
 * Menu per role, URUT sesuai alur pemakaian (login → pantau → kelola).
 * Diagnostik selalu paling bawah (alat sistem, jarang dipakai).
 */
export function navForRole(role: UserRole): NavItem[] {
  const has = (rs: UserRole[]) => rs.includes(role);
  // Urut sesuai alur bisnis: pantau → paket/pengadaan → lokasi → lapor → keuangan → kelola.
  const items: NavItem[] = [
    { href: "/beranda", label: "Beranda", ready: true },
    { href: "/peta", label: "Peta", ready: true },
  ];

  // Paket (pengadaan → kontrak → adendum). Sudah termasuk master kontrak/kontraktor.
  if (has(DASHBOARD)) {
    items.push({ href: "/paket", label: "Paket", ready: true });
  }

  items.push({ href: "/lokasi", label: "Lokasi", ready: true });

  // Laporan / Lapor Harian — pelapor & penyetuju
  if (has(REPORTER) || has(ADMIN)) {
    items.push({
      href: "/laporan",
      label: has(REPORTER) ? "Lapor Harian" : "Laporan",
      ready: true,
    });
  }

  if (has(DASHBOARD)) {
    items.push({ href: "/keuangan", label: "Keuangan", ready: true });
  }

  // Kelola (admin)
  if (has(ADMIN)) {
    items.push({ href: "/pengguna", label: "Pengguna", ready: true });
  }

  // Alat sistem — paling bawah
  if (role === "super_admin") {
    items.push({ href: "/diagnostik", label: "Diagnostik", ready: true });
  }

  return items;
}
