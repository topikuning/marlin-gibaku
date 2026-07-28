"use client";

import { Bell, ChevronDown, ChevronRight, LogOut, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UserRole } from "@/generated/prisma/enums";
import type { Branding } from "@/lib/branding";
import { ROLE_LABEL } from "@/lib/authz";
import { useDismissable } from "@/components/ui";
import { ICONS, type NavItem } from "./nav-config";

export interface TopbarUser {
  fullName: string;
  role: UserRole;
}

export interface TopbarProps {
  brand: Branding;
  user: TopbarUser;
  nav: NavItem[];
  logoutAction: (formData: FormData) => Promise<void>;
  children?: ReactNode;
}

function currentLabel(pathname: string, nav: NavItem[]): string {
  const candidates = nav
    .filter((item) => item.href === pathname || (item.href !== "/" && pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length);
  return candidates[0]?.label ?? (pathname === "/" ? "Command centre" : "Workspace");
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/** Topbar produksi: scope, pencarian navigasi, pusat tindakan, dan konteks user. */
export function Topbar({ brand, user, nav, logoutAction, children }: TopbarProps) {
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [userOpen, setUserOpen] = useState(false);
  const userDismiss = useDismissable(userOpen, () => setUserOpen(false));

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("id-ID");
    if (normalized.length < 2) return [];
    return nav
      .filter((item) => `${item.label} ${item.group}`.toLocaleLowerCase("id-ID").includes(normalized))
      .slice(0, 6);
  }, [nav, query]);

  return (
    <header className="no-print sticky top-0 z-20 h-16 border-b border-border bg-surface/95 backdrop-blur">
      <div className="flex h-full items-center gap-3 px-4 sm:px-5 lg:px-7">
        <a
          href="#main-content"
          className="sr-only rounded-md bg-surface px-3 py-2 font-medium text-primary focus:not-sr-only"
        >
          Lewati ke konten utama
        </a>

        <div className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
          <span className="truncate text-ink-muted">Portfolio nasional</span>
          <ChevronRight aria-hidden className="size-3.5 text-ink-faint" />
          <strong className="truncate text-ink">{currentLabel(pathname, nav)}</strong>
        </div>
        <strong className="shrink-0 text-sm tracking-wide text-primary lg:hidden">
          {brand.appName}
        </strong>

        <div className="relative ml-auto min-w-0 flex-1 sm:max-w-md lg:ml-4">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Cari menu atau halaman"
            placeholder="Cari menu atau halaman…"
            className="h-10 w-full rounded-md border border-border bg-surface-muted pl-9 pr-9 text-sm text-ink outline-none focus:border-primary-400 focus:bg-surface"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-ink-muted sm:block">
            /
          </kbd>

          {matches.length > 0 ? (
            <div className="absolute inset-x-0 top-[calc(100%+6px)] overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
              <p className="border-b border-border px-3 py-2 text-[11px] font-bold tracking-wide text-ink-muted uppercase">
                Tujuan
              </p>
              {matches.map((item) => {
                const Icon = ICONS[item.icon];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setQuery("")}
                    className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm text-ink hover:bg-surface-muted"
                  >
                    <Icon aria-hidden className="size-4 text-primary" />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate font-medium">{item.label}</strong>
                      <small className="block text-xs text-ink-muted">{item.group}</small>
                    </span>
                    <ChevronRight aria-hidden className="size-4 text-ink-faint" />
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>

        {nav.some((item) => item.href === "/tindakan") ? (
          <Link
            href="/tindakan"
            aria-label="Buka pusat tindakan"
            className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            <Bell aria-hidden className="size-[18px]" />
          </Link>
        ) : null}

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              if (userOpen) userDismiss.close();
              else {
                userDismiss.capture();
                setUserOpen(true);
              }
            }}
            aria-expanded={userOpen}
            aria-label="Buka menu pengguna"
            className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-1.5 pr-2 text-left hover:bg-surface-muted"
          >
            <span className="grid size-7 place-items-center rounded-md bg-primary text-[11px] font-bold text-white">
              {initials(user.fullName)}
            </span>
            <span className="hidden max-w-40 min-w-0 sm:block">
              <strong className="block truncate text-xs font-semibold text-ink">{user.fullName}</strong>
              <small className="block truncate text-[10px] text-ink-muted">{ROLE_LABEL[user.role]}</small>
            </span>
            <ChevronDown aria-hidden className="hidden size-3.5 text-ink-muted sm:block" />
          </button>

          {userOpen ? (
            <div className="absolute right-0 top-[calc(100%+6px)] w-64 rounded-lg border border-border bg-surface p-2 shadow-xl">
              <div className="border-b border-border px-2 pb-2">
                <p className="text-xs font-semibold text-ink">{user.fullName}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">{ROLE_LABEL[user.role]} · {brand.projectContext}</p>
              </div>
              {children ? <div className="px-2 py-2 text-xs text-ink-muted">{children}</div> : null}
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  <LogOut aria-hidden className="size-4" />
                  Keluar
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
