"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Branding } from "@/lib/branding";
import { cn } from "@/lib/cn";
import { flattenNav, ICONS, matchActiveHref, type NavGroup } from "./nav-config";

/** Sidebar desktop (≥lg). Nav sudah difilter capability oleh caller. */
export function Sidebar({ nav, brand }: { nav: NavGroup[]; brand: Branding }) {
  const pathname = usePathname();
  // Satu menu aktif untuk seluruh sidebar — dihitung sekali dari semua href
  // yang terlihat supaya menu bersarang tidak menyala berbarengan.
  const active = matchActiveHref(
    pathname,
    flattenNav(nav).map((i) => i.href),
  );

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
        <ul className="space-y-2">
          {nav.map((group) =>
            group.href !== undefined && group.items.length === 0 ? (
              // Grup daun (Beranda): satu tujuan, tanpa judul grup — judul di
              // atas satu baris tautan hanya mengulang kata yang sama.
              <li key={group.label}>
                <NavLink
                  href={group.href}
                  label={group.label}
                  icon={group.icon}
                  active={active === group.href}
                />
              </li>
            ) : (
              <li key={group.label}>
                {/* Judul grup: penanda bagian, bukan tautan. Sengaja bukan
                    tombol lipat — melipat menambah klik untuk pengguna lapangan
                    yang membuka menu yang sama tiap hari. */}
                <p
                  id={`nav-grup-${slug(group.label)}`}
                  className="px-3 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-ink-faint uppercase"
                >
                  {group.label}
                </p>
                <ul aria-labelledby={`nav-grup-${slug(group.label)}`} className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink
                        href={item.href}
                        label={item.label}
                        icon={item.icon}
                        active={active === item.href}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
      </nav>
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  active: boolean;
}) {
  const Icon = ICONS[icon];
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
        active
          ? "bg-primary-50 text-primary"
          : "text-ink-muted hover:bg-surface-muted hover:text-ink",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </Link>
  );
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
