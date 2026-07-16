"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ICONS, type NavItem } from "./nav-config";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Navigasi bawah mobile (<lg): maks 4 item pintasan + tombol "Menu" yang
 * membuka drawer berisi SELURUH navigasi (sudah difilter capability) — di
 * mobile sidebar tersembunyi, jadi drawer ini satu-satunya jalan ke menu lain.
 */
export function BottomNav({ nav, fullNav }: { nav: NavItem[]; fullNav: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Tutup drawer setiap navigasi berhasil (adjust-state-during-render,
  // bukan effect — hindari render kaskade).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(false);
  }

  if (nav.length === 0 && fullNav.length === 0) return null;
  const shortcuts = nav.slice(0, 4);
  const showMenu = fullNav.length > shortcuts.length;
  const cols = shortcuts.length + (showMenu ? 1 : 0);

  return (
    <>
      {open ? (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Semua menu">
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Semua menu</p>
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => setOpen(false)}
                className="flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <ul className="grid grid-cols-3 gap-2">
              {fullNav.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-medium",
                        active
                          ? "border-primary bg-primary-50 text-primary"
                          : "border-border text-ink-muted hover:bg-surface-muted hover:text-ink",
                      )}
                    >
                      <Icon aria-hidden className="size-5" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Navigasi bawah"
        className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {shortcuts.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium",
                    active ? "text-primary" : "text-ink-muted",
                  )}
                >
                  <Icon aria-hidden className="size-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
          {showMenu ? (
            <li>
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-expanded={open}
                className={cn(
                  "flex min-h-12 w-full flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium",
                  open ? "text-primary" : "text-ink-muted",
                )}
              >
                <Menu aria-hidden className="size-5" />
                Menu
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
    </>
  );
}
