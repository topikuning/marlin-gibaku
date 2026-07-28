"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { Branding } from "@/lib/branding";
import { cn } from "@/lib/cn";
import { BottomNav } from "./bottom-nav";
import type { NavItem } from "./nav-config";
import { Sidebar } from "./sidebar";
import { Topbar, type TopbarUser } from "./topbar";

export interface AppShellProps {
  brand: Branding;
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
 * Kerangka aplikasi client ringan: menyimpan preferensi rail selama navigasi,
 * sementara seluruh children tetap dirender oleh Server Components pemiliknya.
 */
export function AppShell({
  brand,
  user,
  nav,
  mobileNav,
  logoutAction,
  topbarContent,
  children,
}: AppShellProps) {
  const [railCompact, setRailCompact] = useState(false);

  return (
    <div className="min-h-dvh">
      <Sidebar
        brand={brand}
        nav={nav}
        compact={railCompact}
        onCompactChange={setRailCompact}
      />
      <div className={cn("transition-[padding]", railCompact ? "lg:pl-20" : "lg:pl-[272px]")}>
        <Topbar brand={brand} user={user} nav={nav} logoutAction={logoutAction}>
          {topbarContent}
        </Topbar>
        <main
          id="main-content"
          className="mx-auto w-full max-w-[1720px] px-4 py-5 pb-20 sm:px-5 lg:px-7 lg:py-6 lg:pb-8"
        >
          {children}
        </main>
      </div>
      <BottomNav nav={mobileNav ?? nav.slice(0, 4)} fullNav={nav} />
    </div>
  );
}
