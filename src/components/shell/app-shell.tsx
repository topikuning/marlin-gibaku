import type { ReactNode } from "react";
import type { Branding } from "@/lib/branding";
import { BottomNav } from "./bottom-nav";
import type { NavGroup, NavItem } from "./nav-config";
import { NavProgressBar } from "./nav-progress";
import { Sidebar } from "./sidebar";
import { Topbar, type TopbarUser } from "./topbar";

export interface AppShellProps {
  brand: Branding;
  user: TopbarUser;
  /**
   * Nav BERKELOMPOK untuk sidebar desktop — enam grup cara-kerja (PRD §3.3).
   * Sudah difilter capability (pakai filterNavGroups(role)).
   */
  navGroups: NavGroup[];
  /** Nav rata (filterNav(role)) — dipakai laci menu mobile. */
  nav: NavItem[];
  /** Nav bawah mobile (pakai MOBILE_NAV(role)). Default: 4 item pertama `nav`. */
  mobileNav?: NavItem[];
  /** Server action logout, diteruskan ke Topbar. */
  logoutAction: (formData: FormData) => Promise<void>;
  /** Slot topbar kiri: breadcrumb/judul ringkas. */
  topbarContent?: ReactNode;
  children: ReactNode;
}

/**
 * Kerangka aplikasi (server component):
 * sidebar desktop + topbar + konten fluid + bottom-nav mobile.
 */
export function AppShell({
  brand,
  user,
  navGroups,
  nav,
  mobileNav,
  logoutAction,
  topbarContent,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-dvh">
      {/* Umpan balik navigasi untuk SELURUH aplikasi — termasuk perpindahan
          yang bukan dari menu (tombol, tautan tabel, breadcrumb). Diletakkan
          paling atas supaya tetap terlihat walau laci menu sudah tertutup. */}
      <NavProgressBar />
      <Sidebar brand={brand} groups={navGroups} />
      <div className="lg:pl-60">
        <Topbar brand={brand} user={user} logoutAction={logoutAction}>
          {topbarContent}
        </Topbar>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 pb-20 lg:px-6 lg:pb-8">
          {children}
        </main>
      </div>
      <BottomNav nav={mobileNav ?? nav.slice(0, 4)} fullNav={nav} />
    </div>
  );
}
