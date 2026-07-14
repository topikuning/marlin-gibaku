import {
  FileText,
  FolderOpen,
  Home,
  Map,
  MapPin,
  Package,
  Settings,
  Sun,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { UserRole } from "@/generated/prisma/enums";
import { can, type Capability } from "@/lib/authz";

/**
 * Konfigurasi navigasi. NavItem serializable (icon = key string) sehingga
 * aman dilewatkan dari Server Component ke client (sidebar/bottom-nav).
 * Filter capability dilakukan DI SINI — shell tidak tahu authz.
 */

export const ICONS = {
  home: Home,
  package: Package,
  mapPin: MapPin,
  map: Map,
  sun: Sun,
  trendingUp: TrendingUp,
  wallet: Wallet,
  folderOpen: FolderOpen,
  fileText: FileText,
  users: Users,
  settings: Settings,
} as const;

export type NavItem = {
  label: string;
  href: string;
  icon: keyof typeof ICONS;
  /** Tanpa capability = tampil untuk semua role. */
  capability?: Capability;
};

export const MAIN_NAV: NavItem[] = [
  { label: "Beranda", href: "/", icon: "home" },
  { label: "Paket", href: "/paket", icon: "package", capability: "package.view" },
  { label: "Lokasi", href: "/lokasi", icon: "mapPin", capability: "location.view" },
  { label: "Peta", href: "/peta", icon: "map", capability: "location.view" },
  { label: "Hari Ini", href: "/hari-ini", icon: "sun", capability: "daily_report.create" },
  { label: "Progress", href: "/progress", icon: "trendingUp", capability: "progress.view" },
  { label: "Keuangan", href: "/keuangan", icon: "wallet", capability: "finance.view" },
  { label: "Dokumen", href: "/dokumen", icon: "folderOpen", capability: "document.view" },
  { label: "Laporan", href: "/laporan", icon: "fileText", capability: "report.export" },
  { label: "Pengguna", href: "/pengguna", icon: "users", capability: "user.manage" },
  { label: "Sistem", href: "/sistem", icon: "settings", capability: "system.manage" },
];

function allowed(role: UserRole, item: NavItem): boolean {
  return !item.capability || can(role, item.capability);
}

export function filterNav(role: UserRole): NavItem[] {
  return MAIN_NAV.filter((item) => allowed(role, item));
}

const FIELD_ROLES: ReadonlySet<UserRole> = new Set([
  "site_manager",
  "field_supervisor",
]);

/** Navigasi bawah mobile — maksimal 5 item, sudah difilter capability. */
export function MOBILE_NAV(role: UserRole): NavItem[] {
  const items: NavItem[] = FIELD_ROLES.has(role)
    ? [
        { label: "Hari Ini", href: "/hari-ini", icon: "sun", capability: "daily_report.create" },
        { label: "Proyek", href: "/lokasi", icon: "mapPin", capability: "location.view" },
        { label: "Laporan", href: "/laporan", icon: "fileText", capability: "report.export" },
        { label: "Lainnya", href: "/", icon: "home" },
      ]
    : [
        { label: "Beranda", href: "/", icon: "home" },
        { label: "Paket", href: "/paket", icon: "package", capability: "package.view" },
        { label: "Lokasi", href: "/lokasi", icon: "mapPin", capability: "location.view" },
        { label: "Progress", href: "/progress", icon: "trendingUp", capability: "progress.view" },
      ];
  return items.filter((item) => allowed(role, item)).slice(0, 5);
}
