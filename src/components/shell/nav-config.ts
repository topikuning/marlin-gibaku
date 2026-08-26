import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  Database,
  Gauge,
  MessagesSquare,
  Camera,
  FileText,
  Images,
  FolderOpen,
  Home,
  Map,
  MapPin,
  Package,
  Send,
  Settings,
  ShieldCheck,
  Siren,
  Sparkles,
  Sun,
  TrendingUp,
  Users,
  Wallet,
  Mail,
  Inbox,
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
  images: Images,
  package: Package,
  mapPin: MapPin,
  map: Map,
  sun: Sun,
  trendingUp: TrendingUp,
  alertTriangle: AlertTriangle,
  wallet: Wallet,
  folderOpen: FolderOpen,
  fileText: FileText,
  send: Send,
  database: Database,
  messagesSquare: MessagesSquare,
  sparkles: Sparkles,
  users: Users,
  settings: Settings,
  clipboardCheck: ClipboardCheck,
  shieldCheck: ShieldCheck,
  siren: Siren,
  gauge: Gauge,
  mail: Mail,
  inbox: Inbox,
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

export const MAIN_NAV: NavItem[] = [
  { label: "Beranda", href: "/", icon: "home" },
  { label: "Paket", href: "/paket", icon: "package", capability: "package.view" },
  { label: "Lokasi", href: "/lokasi", icon: "mapPin", capability: "location.view" },
  { label: "Peta", href: "/peta", icon: "map", capability: "location.view" },
  { label: "Hari Ini", href: "/hari-ini", icon: "sun", capability: "daily_report.create" },
  // Foto Cepat SENGAJA berdiri sendiri di atas galeri: ia aksi lapangan
  // (jepret sekarang), bukan tempat menelusuri arsip. DECISIONS 253.
  { label: "Foto Cepat", href: "/foto-cepat", icon: "camera", capability: "photo.quick" },
  { label: "Foto Lapangan", href: "/foto", icon: "images", capability: "location.view" },
  { label: "AI Intelligence", href: "/ai", icon: "sparkles", capability: "ai.view" },
  { label: "Progress", href: "/progress", icon: "trendingUp", capability: "progress.view" },
  // Papan kendala lintas lokasi (DECISIONS 392). Pakai `location.view`, bukan
  // `issue.manage`: yang tidak boleh mengubah tetap perlu MELIHAT apa yang
  // sedang menghambat lokasinya.
  { label: "Kendala", href: "/kendala", icon: "alertTriangle", capability: "location.view" },
  // Pengendalian terpadu (DECISIONS 426): temuan pemeriksa, workspace
  // verifikasi Wakil PPK, EWS, dan kesiapan termin/PHO/FHO.
  { label: "Temuan", href: "/temuan", icon: "clipboardCheck", capability: "finding.view" },
  { label: "Verifikasi", href: "/verifikasi", icon: "shieldCheck", capability: "report.verify_external" },
  { label: "Perlu Tindakan", href: "/perlu-tindakan", icon: "siren", capability: "portfolio.view" },
  { label: "Kesiapan", href: "/kesiapan", icon: "gauge", capability: "package.view" },
  { label: "Keuangan", href: "/keuangan", icon: "wallet", capability: "finance.view" },
  { label: "Dokumen", href: "/dokumen", icon: "folderOpen", capability: "document.view" },
  // Register surat + antrean lampiran grup WA (DECISIONS 432).
  { label: "Surat", href: "/surat", icon: "mail", capability: "letter.view" },
  { label: "Lampiran Masuk", href: "/lampiran", icon: "inbox", capability: "letter.manage" },
  { label: "Laporan", href: "/laporan", icon: "fileText", capability: "report.export" },
  // "Laporan → WA" dilebur ke Report Studio (/ai/reports) — DECISIONS 193/194.
  // Route /laporan-wa dialihkan ke sana; jangan hidupkan lagi sebagai menu.
  { label: "Chat Grup", href: "/chat-grup", icon: "messagesSquare", capability: "wa.chat" },
  {
    label: "Master Data",
    href: "/master",
    icon: "database",
    anyCapability: ["contract.manage", "package.bypass", "wa.chat", "user.create"],
  },
  { label: "Sistem", href: "/sistem", icon: "settings", capability: "system.manage" },
];

function allowed(role: UserRole, item: NavItem): boolean {
  if (item.anyCapability) return item.anyCapability.some((c) => can(role, c));
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
  // Wakil PPK: pekerjaan lapangannya adalah MEMERIKSA — verifikasi & temuan
  // harus satu ketukan, sama alasannya dengan Foto Cepat bagi mandor.
  if (role === "wakil_ppk") {
    const wakil: NavItem[] = [
      { label: "Beranda", href: "/", icon: "home" },
      { label: "Verifikasi", href: "/verifikasi", icon: "shieldCheck", capability: "report.verify_external" },
      { label: "Temuan", href: "/temuan", icon: "clipboardCheck", capability: "finding.view" },
      { label: "Lokasi", href: "/lokasi", icon: "mapPin", capability: "location.view" },
    ];
    return wakil.filter((item) => allowed(role, item)).slice(0, 4);
  }
  const items: NavItem[] = FIELD_ROLES.has(role)
    ? [
        { label: "Hari Ini", href: "/hari-ini", icon: "sun", capability: "daily_report.create" },
        // Satu ketukan dari mana pun — inti Foto Cepat. Kalau ia terkubur di
        // laci menu, mandor akan tetap memotret pakai aplikasi kamera HP dan
        // fotonya tetap datang tanpa koordinat. DECISIONS 253.
        { label: "Foto", href: "/foto-cepat", icon: "camera", capability: "photo.quick" },
        { label: "Proyek", href: "/lokasi", icon: "mapPin", capability: "location.view" },
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
