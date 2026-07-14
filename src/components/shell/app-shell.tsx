import type { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import type { NavItem } from "./nav-config";
import { Sidebar } from "./sidebar";
import { Topbar, type TopbarUser } from "./topbar";

export interface AppShellProps {
  user: TopbarUser;
  /** Nav SUDAH difilter capability (pakai filterNav(role)) — shell tidak tahu authz. */
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
  user,
  nav,
  mobileNav,
  logoutAction,
  topbarContent,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <Sidebar nav={nav} />
      <div className="lg:pl-60">
        <Topbar user={user} logoutAction={logoutAction}>
          {topbarContent}
        </Topbar>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 pb-20 lg:px-6 lg:pb-8">
          {children}
        </main>
      </div>
      <BottomNav nav={mobileNav ?? nav.slice(0, 4)} />
    </div>
  );
}
