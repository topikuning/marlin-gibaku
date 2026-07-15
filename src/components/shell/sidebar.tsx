"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Branding } from "@/lib/branding";
import { cn } from "@/lib/cn";
import { ICONS, type NavItem } from "./nav-config";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Sidebar desktop (≥lg). Nav sudah difilter capability oleh caller. */
export function Sidebar({ nav, brand }: { nav: NavItem[]; brand: Branding }) {
  const pathname = usePathname();
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <span aria-hidden className="h-8 w-1 rounded-full bg-brand-red" />
        <div className="min-w-0">
          <p className="text-base leading-none font-bold tracking-tight text-primary">
            {brand.appName}
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-ink-muted">
            {brand.projectContext}
          </p>
        </div>
      </div>
      <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {nav.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
                    active
                      ? "bg-primary-50 text-primary"
                      : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
