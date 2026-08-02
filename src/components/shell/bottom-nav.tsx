"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useDismissable } from "@/components/ui";
import { cn } from "@/lib/cn";
import { flattenNav, ICONS, matchActiveHref, type NavGroup, type NavItem } from "./nav-config";

/**
 * Navigasi bawah mobile (<lg): maks 4 item pintasan + tombol "Menu" yang
 * membuka drawer berisi SELURUH navigasi (sudah difilter capability) — di
 * mobile sidebar tersembunyi, jadi drawer ini satu-satunya jalan ke menu lain.
 * Drawer memakai enam grup yang sama dengan sidebar; satu grid datar berisi
 * belasan ubin memaksa pengguna memindai semuanya untuk menemukan satu menu.
 */
export function BottomNav({ nav, fullNav }: { nav: NavItem[]; fullNav: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Escape menutup + fokus kembali ke tombol "Menu" (audit UI 2026-07-27).
  const dismiss = useDismissable(open, () => setOpen(false));

  // Tutup drawer setiap navigasi berhasil (adjust-state-during-render,
  // bukan effect — hindari render kaskade).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(false);
  }

  const flat = flattenNav(fullNav);
  if (nav.length === 0 && flat.length === 0) return null;
  const shortcuts = nav.slice(0, 4);
  const showMenu = flat.length > shortcuts.length;
  const cols = shortcuts.length + (showMenu ? 1 : 0);
  const active = matchActiveHref(pathname, [
    ...flat.map((i) => i.href),
    ...shortcuts.map((i) => i.href),
  ]);

  return (
    <>
      {open ? (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Semua menu">
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={dismiss.close}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Semua menu</p>
              <button
                type="button"
                aria-label="Tutup"
                autoFocus
                onClick={dismiss.close}
                className="flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <div className="space-y-3">
              {fullNav.map((group) => {
                const items =
                  group.href !== undefined && group.items.length === 0
                    ? [{ label: group.label, href: group.href, icon: group.icon }]
                    : group.items;
                const headingId = `menu-grup-${slug(group.label)}`;
                return (
                  <section key={group.label} aria-labelledby={headingId}>
                    <h2
                      id={headingId}
                      className="mb-1.5 px-0.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase"
                    >
                      {group.label}
                    </h2>
                    <ul className="grid grid-cols-3 gap-2">
                      {items.map((item) => {
                        const Icon = ICONS[item.icon];
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              aria-current={active === item.href ? "page" : undefined}
                              onClick={() => setOpen(false)}
                              className={cn(
                                "flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-center text-[11px] font-medium",
                                active === item.href
                                  ? "border-primary bg-primary-50 text-primary"
                                  : "border-border text-ink-muted hover:bg-surface-muted hover:text-ink",
                              )}
                            >
                              <Icon aria-hidden className="size-5 shrink-0" />
                              {item.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
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
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active === item.href ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium",
                    active === item.href ? "text-primary" : "text-ink-muted",
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
                onClick={() => {
                  dismiss.capture();
                  setOpen(true);
                }}
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

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
