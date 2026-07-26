import {
  Activity,
  BookUser,
  Camera,
  FileText,
  FolderOpen,
  Home,
  Map,
  MapPin,
  Package,
  Send,
  Settings,
  Sparkles,
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
  activity: Activity,
  camera: Camera,
  package: Package,
  mapPin: MapPin,
  map: Map,
  sun: Sun,
  trendingUp: TrendingUp,
  wallet: Wallet,
  folderOpen: FolderOpen,
  fileText: FileText,
  send: Send,
  bookUser: BookUser,
  sparkles: Sparkles,
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
  { label: "Foto Lapangan", href: "/foto", icon: "camera", capability: "location.view" },
  { label: "AI Intelligence", href: "/ai", icon: "sparkles", capability: "ai.view" },
  { label: "Progress", href: "/progress", icon: "trendingUp", capability: "progress.view" },
  { label: "Keuangan", href: "/keuangan", icon: "wallet", capability: "finance.view" },
  { label: "Dokumen", href: "/dokumen", icon: "folderOpen", capability: "document.view" },
  { label: "Laporan", href: "/laporan", icon: "fileText", capability: "report.export" },
  { label: "Laporan → WA", href: "/laporan-wa", icon: "send", capability: "exec_report.send" },
  { label: "Kontak WA", href: "/kontak-wa", icon: "bookUser", capability: "exec_report.send" },
  { label: "Pengguna", href: "/pengguna", icon: "users", capability: "user.create" },
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

/**
 * Pintasan navigasi bawah mobile — maksimal 4 item; BottomNav menambahkan
 * tombol "Menu" (drawer nav lengkap) sehingga menu lain tetap terjangkau.
 */
export function MOBILE_NAV(role: UserRole): NavItem[] {
  const items: NavItem[] = FIELD_ROLES.has(role)
    ? [
        { label: "Hari Ini", href: "/hari-ini", icon: "sun", capability: "daily_report.create" },
        { label: "Proyek", href: "/lokasi", icon: "mapPin", capability: "location.view" },
        { label: "Laporan", href: "/laporan", icon: "fileText", capability: "report.export" },
        { label: "Beranda", href: "/", icon: "home" },
      ]
    : [
        { label: "Beranda", href: "/", icon: "home" },
        { label: "Paket", href: "/paket", icon: "package", capability: "package.view" },
        { label: "Lokasi", href: "/lokasi", icon: "mapPin", capability: "location.view" },
        { label: "Progress", href: "/progress", icon: "trendingUp", capability: "progress.view" },
      ];
  return items.filter((item) => allowed(role, item)).slice(0, 4);
}
