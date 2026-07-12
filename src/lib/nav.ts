import type { UserRole } from "@prisma/client";

export type NavItem = {
  href: string;
  label: string;
  /** false = halaman belum dibangun (tampil sebagai "segera", tidak diklik). */
  ready: boolean;
};

/**
 * Menu per role. Item `ready: false` = fitur roadmap yang belum ada (v0.2+),
 * ditampilkan jujur sebagai "segera" biar navigasi tidak punya link mati.
 */
export function navForRole(role: UserRole): NavItem[] {
  const items: NavItem[] = [
    { href: "/beranda", label: "Beranda", ready: true },
    { href: "/peta", label: "Peta", ready: true },
    { href: "/lokasi", label: "Lokasi", ready: true },
  ];

  if (role === "super_admin" || role === "program_director") {
    items.push({ href: "/laporan", label: "Laporan", ready: true });
    items.push({ href: "/kontrak", label: "Kontrak", ready: true });
    items.push({ href: "/pengguna", label: "Pengguna", ready: true });
  }
  if (role === "site_manager" || role === "field_supervisor") {
    items.push({ href: "/laporan", label: "Lapor Harian", ready: true });
  }
  // Dashboard tidak lagi menu terpisah — overprogress-nya ada di Beranda
  // (DECISIONS 026). Ringkasan kurva-S tampil otomatis untuk role yang berhak.

  return items;
}
