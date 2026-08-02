import {
  Building2,
  Camera,
  Database,
  FileText,
  FolderOpen,
  Gauge,
  HardHat,
  Home,
  Map,
  MapPin,
  MessagesSquare,
  Package,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { UserRole } from "@/generated/prisma/enums";
import { can, type Capability } from "@/lib/authz";

/**
 * Konfigurasi navigasi. NavItem/NavGroup serializable (icon = key string)
 * sehingga aman dilewatkan dari Server Component ke client (sidebar/bottom-nav).
 * Filter capability dilakukan DI SINI — shell tidak tahu authz.
 *
 * BENTUK: enam grup, bukan daftar datar (PRD MARLIN §3.2–3.3, DECISIONS 222).
 * URL tiap menu TIDAK berubah — yang berubah hanya pengelompokannya.
 */

export const ICONS = {
  home: Home,
  camera: Camera,
  package: Package,
  mapPin: MapPin,
  map: Map,
  sun: Sun,
  hardHat: HardHat,
  gauge: Gauge,
  trendingUp: TrendingUp,
  wallet: Wallet,
  folderOpen: FolderOpen,
  fileText: FileText,
  send: Send,
  database: Database,
  building: Building2,
  messagesSquare: MessagesSquare,
  sparkles: Sparkles,
  users: Users,
  shieldCheck: ShieldCheck,
  settings: Settings,
} as const;

export type NavItem = {
  label: string;
  href: string;
  icon: keyof typeof ICONS;
  /** Tanpa capability = tampil untuk semua role. */
  capability?: Capability;
  /** Alternatif: tampil bila punya SALAH SATU capability ini (menu gabungan). */
  anyCapability?: Capability[];
};

/**
 * Grup navigasi tingkat atas. Dua bentuk:
 * - **grup daun** (`href` terisi, `items` kosong) — satu tujuan tanpa sub-menu,
 *   dirender sebagai satu baris tautan biasa. Hanya Beranda.
 * - **grup biasa** (`items` terisi) — judul grup + daftar sub-menu.
 */
export type NavGroup = {
  label: string;
  icon: keyof typeof ICONS;
  /** Grup daun: langsung menuju satu halaman. */
  href?: string;
  items: NavItem[];
};

/**
 * Enam grup. Setiap menu lama tetap ada — yang hilang dari daftar ini berarti
 * hilang dari aplikasi, jadi jangan menghapus tanpa mengganti tempatnya.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Beranda",
    icon: "home",
    href: "/",
    items: [],
  },
  {
    label: "Proyek",
    icon: "package",
    items: [
      { label: "Portofolio Paket", href: "/paket", icon: "package", capability: "package.view" },
      { label: "Portofolio Lokasi", href: "/lokasi", icon: "mapPin", capability: "location.view" },
      { label: "Peta Lokasi", href: "/peta", icon: "map", capability: "location.view" },
    ],
  },
  {
    label: "Pelaksanaan",
    icon: "hardHat",
    items: [
      { label: "Hari Ini", href: "/hari-ini", icon: "sun", capability: "daily_report.create" },
      { label: "Galeri Foto", href: "/foto", icon: "camera", capability: "location.view" },
    ],
  },
  {
    label: "Pengendalian",
    icon: "gauge",
    items: [
      { label: "Progress & Deviasi", href: "/progress", icon: "trendingUp", capability: "progress.view" },
      { label: "Keuangan", href: "/keuangan", icon: "wallet", capability: "finance.view" },
      // Report Studio + distribusi WA hidup di dalam hub ini (DECISIONS 193/194):
      // tidak ada jalur generate-lalu-kirim tanpa review, jadi jangan dipecah
      // kembali menjadi menu "Laporan → WA" tersendiri.
      { label: "Insight & AI", href: "/ai", icon: "sparkles", capability: "ai.view" },
    ],
  },
  {
    label: "Dokumen & Laporan",
    icon: "folderOpen",
    items: [
      { label: "Pusat Dokumen", href: "/dokumen", icon: "folderOpen", capability: "document.view" },
      { label: "Pusat Laporan", href: "/laporan", icon: "fileText", capability: "report.export" },
      { label: "Ringkasan Chat", href: "/chat-grup", icon: "messagesSquare", capability: "wa.chat" },
    ],
  },
  {
    label: "Administrasi",
    icon: "shieldCheck",
    items: [
      { label: "Perusahaan & Vendor", href: "/master/perusahaan", icon: "building", capability: "contract.manage" },
      // Katalog lokasi induk: dulu hanya terjangkau dari halaman Paket, padahal
      // isinya data referensi. Dimunculkan sebagai menu supaya tidak tersembunyi.
      { label: "Master Lokasi", href: "/paket/katalog", icon: "database", capability: "package.bypass" },
      { label: "Pengguna & Penugasan", href: "/master/pengguna", icon: "users", capability: "user.create" },
      { label: "Kontak WhatsApp", href: "/master/kontak", icon: "send", capability: "wa.chat" },
      { label: "Sistem & Audit", href: "/sistem", icon: "settings", capability: "system.manage" },
    ],
  },
];

function allowed(role: UserRole, item: NavItem): boolean {
  if (item.anyCapability) return item.anyCapability.some((c) => can(role, c));
  return !item.capability || can(role, item.capability);
}

/**
 * Grup + sub-menu yang boleh dilihat role ini. Grup yang seluruh isinya
 * tersaring habis IKUT hilang — judul grup kosong hanya jadi ruang mati.
 */
export function filterNav(role: UserRole): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => allowed(role, item)),
  })).filter((group) => group.href !== undefined || group.items.length > 0);
}

/** Seluruh sub-menu yang terlihat, tanpa pengelompokan (mis. untuk pintasan). */
export function flattenNav(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((group) =>
    group.href !== undefined && group.items.length === 0
      ? [{ label: group.label, href: group.href, icon: group.icon }]
      : group.items,
  );
}

/**
 * Menu mana yang sedang aktif. Pencocokan awalan saja TIDAK cukup sejak menu
 * bersarang ada: `/paket/katalog` juga berawalan `/paket`, sehingga "Portofolio
 * Paket" dan "Master Lokasi" akan menyala berbarengan. Yang menang adalah
 * kecocokan TERPANJANG — satu menu aktif, bukan dua.
 */
export function matchActiveHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const hit =
      href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (hit && (best === null || href.length > best.length)) best = href;
  }
  return best;
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
