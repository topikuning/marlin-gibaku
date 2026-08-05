import {
  Activity,
  Database,
  MessagesSquare,
  Camera,
  FileText,
  FolderOpen,
  Home,
  ListChecks,
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
 *
 * ENAM GRUP, bukan 15 menu datar (PRD §3.2/§3.3, FR-NAV-01). Menu lama berdiri
 * sejajar semua — Foto Lapangan, Chat Grup dan Master Data sederajat dengan
 * Beranda — sehingga urutannya tidak menceritakan apa pun tentang cara kerja.
 * Pengelompokan di bawah ini mengikuti ALUR KERJA, bukan tabel database:
 *
 *   Beranda            apa yang harus saya tindak
 *   Proyek             objek induk: paket → lokasi (peta = cara melihat, bukan modul)
 *   Pelaksanaan        pekerjaan harian di lapangan
 *   Pengendalian       rencana vs realisasi: progress, uang, analisis
 *   Dokumen & Laporan  bukti masuk dan output keluar
 *   Administrasi       data referensi, akun, konfigurasi
 *
 * TIDAK ADA fungsi yang dibuang — semuanya pindah grup dengan alasan di atas.
 */

export const ICONS = {
  home: Home,
  listChecks: ListChecks,
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
  database: Database,
  messagesSquare: MessagesSquare,
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
  /** Alternatif: tampil bila punya SALAH SATU capability ini (menu gabungan). */
  anyCapability?: Capability[];
};

/**
 * TAB GRUP ADMINISTRASI — satu daftar, tiga pemakai.
 *
 * Urutan halaman Administrasi muncul di TIGA tempat: butir menu di sidebar,
 * deret tab di `administrasi/layout.tsx`, dan urutan pemantulan di
 * `administrasi/page.tsx` (yang meneruskan ke tab pertama yang boleh diakses
 * peran ini). Ketiganya dulu diketik terpisah — dan sudah berselisih: sidebar
 * menaruh Master Lokasi sebelum Pengguna, sedangkan tab dan pemantulnya
 * sebaliknya. Akibatnya urutan berubah begitu pengguna berpindah dari sidebar
 * ke tab, dan yang paling halus: `/administrasi` mendarat di tab yang BUKAN
 * tab pertama yang terlihat, sehingga sorotan tab terasa meleset seketika.
 *
 * Karena itu daftarnya satu. `navLabel` lebih panjang daripada `tabLabel`
 * dengan sengaja — sidebar punya ruang dan butuh menyebut isinya, deret tab
 * tidak.
 */
export const ADMINISTRASI_TABS = [
  {
    navLabel: "Perusahaan & Vendor",
    tabLabel: "Perusahaan",
    href: "/administrasi/perusahaan",
    icon: "database",
    capability: "contract.manage",
  },
  {
    navLabel: "Kontak WhatsApp",
    tabLabel: "Kontak",
    href: "/administrasi/kontak",
    icon: "send",
    capability: "wa.chat",
  },
  {
    navLabel: "Pengguna & Akses",
    tabLabel: "Pengguna",
    href: "/administrasi/pengguna",
    icon: "users",
    capability: "user.create",
  },
  {
    navLabel: "Master Lokasi",
    tabLabel: "Master Lokasi",
    href: "/administrasi/lokasi-master",
    icon: "mapPin",
    capability: "package.bypass",
  },
  {
    navLabel: "Impor & Kualitas Data",
    tabLabel: "Impor",
    href: "/administrasi/impor",
    icon: "fileText",
    capability: "rab.manage",
  },
  {
    navLabel: "Sistem",
    tabLabel: "Sistem",
    href: "/administrasi/sistem",
    icon: "settings",
    capability: "system.manage",
  },
] as const satisfies readonly {
  navLabel: string;
  tabLabel: string;
  href: string;
  icon: keyof typeof ICONS;
  capability: Capability;
}[];

/** Satu grup navigasi = satu cara kerja. Judul tampil sebagai eyebrow caps. */
export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Beranda",
    items: [
      { label: "Command Center", href: "/", icon: "home" },
      {
        label: "Perlu Tindakan",
        href: "/tindakan",
        icon: "listChecks",
        capability: "location.view",
      },
    ],
  },
  {
    label: "Proyek",
    items: [
      { label: "Paket", href: "/proyek/paket", icon: "package", capability: "package.view" },
      { label: "Lokasi", href: "/proyek/lokasi", icon: "mapPin", capability: "location.view" },
      // Peta = MODE MELIHAT daftar lokasi, bukan proses bisnis tersendiri
      // (PRD §3.2). Tetap satu butir menu karena itulah pintu masuk yang
      // dipakai manajemen; workspace lokasi dibuka dari markernya.
      { label: "Peta Monitoring", href: "/proyek/peta", icon: "map", capability: "location.view" },
    ],
  },
  {
    label: "Pelaksanaan",
    items: [
      { label: "Hari Ini", href: "/pelaksanaan", icon: "sun", capability: "daily_report.create" },
      // Foto adalah BUKTI dari laporan/kegiatan, bukan modul mandiri — galeri
      // global hanya view lintas lokasi (PRD §4 "Bukti Foto").
      { label: "Galeri Foto", href: "/pelaksanaan/bukti", icon: "camera", capability: "location.view" },
    ],
  },
  {
    label: "Pengendalian",
    items: [
      { label: "Progress & Deviasi", href: "/pengendalian/progress", icon: "trendingUp", capability: "progress.view" },
      { label: "Keuangan", href: "/pengendalian/keuangan", icon: "wallet", capability: "finance.view" },
      // AI = layanan analisis lintas modul, bukan produk terpisah (PRD §5.11).
      { label: "Insight & AI", href: "/pengendalian/insight", icon: "sparkles", capability: "ai.view" },
    ],
  },
  {
    label: "Dokumen & Laporan",
    items: [
      { label: "Pusat Dokumen", href: "/dokumen-laporan/dokumen", icon: "folderOpen", capability: "document.view" },
      { label: "Pusat Laporan", href: "/dokumen-laporan/laporan", icon: "fileText", capability: "report.export" },
      // "Laporan → WA" dilebur ke Report Studio (/pengendalian/insight/reports)
      // — DECISIONS 193/194. Route lama 308 ke sana (next.config.ts); jangan
      // hidupkan lagi sebagai menu.
      { label: "Ringkasan Chat", href: "/dokumen-laporan/distribusi", icon: "messagesSquare", capability: "wa.chat" },
    ],
  },
  {
    label: "Administrasi",
    items: [
      /*
       * Butir menyebut HALAMANNYA langsung, bukan "Master Data" yang menunjuk
       * `/administrasi` lalu memantul lagi ke tab pertama.
       *
       * Dua alasan. Pertama, sesudah grupnya sendiri bernama Administrasi,
       * butir bernama "Master Data" di dalamnya membuat dua istilah untuk satu
       * tempat. Kedua, tautan yang memantul membuat sorotan menu meleset
       * sekejap dan tombol "kembali" peramban mendarat di pemantulnya, bukan
       * di halaman sebelumnya. Rinciannya mengikuti PRD §3.3.
       */
      ...ADMINISTRASI_TABS.map(
        (t): NavItem => ({ label: t.navLabel, href: t.href, icon: t.icon, capability: t.capability }),
      ),
    ],
  },
];

function allowed(role: UserRole, item: NavItem): boolean {
  if (item.anyCapability) return item.anyCapability.some((c) => can(role, c));
  return !item.capability || can(role, item.capability);
}

/**
 * Grup yang boleh dilihat role ini. Grup yang seluruh isinya tersaring habis
 * ikut hilang — judul grup kosong hanya menyisakan ruang tanpa isi.
 */
export function filterNavGroups(role: UserRole): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allowed(role, i)) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Daftar rata seluruh menu yang boleh dilihat — untuk laci menu mobile. */
export function filterNav(role: UserRole): NavItem[] {
  return filterNavGroups(role).flatMap((g) => g.items);
}

const FIELD_ROLES: ReadonlySet<UserRole> = new Set([
  "site_manager",
  "field_supervisor",
]);

/**
 * Pintasan navigasi bawah mobile — maksimal 4 item; BottomNav menambahkan
 * tombol "Menu" (laci nav lengkap) sehingga menu lain tetap terjangkau.
 *
 * Berbeda per peran dengan sengaja: yang dipegang orang lapangan sepanjang
 * hari bukan yang dibuka manajemen. Pelaksana tidak pernah butuh portfolio;
 * manajemen tidak pernah mengisi laporan dari jempolnya.
 */
export function MOBILE_NAV(role: UserRole): NavItem[] {
  const items: NavItem[] = FIELD_ROLES.has(role)
    ? [
        { label: "Hari Ini", href: "/pelaksanaan", icon: "sun", capability: "daily_report.create" },
        { label: "Lokasi", href: "/proyek/lokasi", icon: "mapPin", capability: "location.view" },
        { label: "Foto", href: "/pelaksanaan/bukti", icon: "camera", capability: "location.view" },
        { label: "Laporan", href: "/dokumen-laporan/laporan", icon: "fileText", capability: "report.export" },
      ]
    : [
        { label: "Beranda", href: "/", icon: "home" },
        { label: "Lokasi", href: "/proyek/lokasi", icon: "mapPin", capability: "location.view" },
        { label: "Progress", href: "/pengendalian/progress", icon: "trendingUp", capability: "progress.view" },
        { label: "Tindakan", href: "/tindakan", icon: "listChecks", capability: "location.view" },
      ];
  return items.filter((item) => allowed(role, item)).slice(0, 4);
}
