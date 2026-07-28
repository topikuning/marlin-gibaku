"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { cn } from "@/lib/cn";
import { ICONS, NAV_GROUP_ORDER, type NavItem } from "./nav-config";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Rail desktop berkelompok. Nav sudah difilter capability oleh caller. */
export function Sidebar({
  nav,
  brand,
  compact,
  onCompactChange,
}: {
  nav: NavItem[];
  brand: Branding;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
}) {
  const pathname = usePathname();
  return (
    <aside
      className={cn(
        "no-print fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-700 bg-slate-950 text-white transition-[width] lg:flex",
        compact ? "w-20" : "w-[272px]",
      )}
    >
      <div className={cn("flex h-20 items-center border-b border-slate-700", compact ? "justify-center px-3" : "gap-3 px-5")}>
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-cyan-400 text-lg font-black text-slate-950"
        >
          {brand.appName.slice(0, 1).toUpperCase()}
        </span>
        <div className={cn("min-w-0", compact && "sr-only")}>
          <p className="text-lg leading-none font-bold tracking-[0.12em] text-white">
            {brand.appName}
          </p>
          <p className="mt-1.5 line-clamp-2 text-xs leading-tight text-slate-400">
            {brand.projectContext}
          </p>
        </div>
      </div>

      <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUP_ORDER.map((group) => {
          const items = nav.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <section className="mb-5" key={group} aria-labelledby={`nav-${group}`}>
              <h2
                id={`nav-${group}`}
                className={cn(
                  "mb-1.5 px-3 text-[11px] font-bold tracking-[0.16em] text-slate-500 uppercase",
                  compact && "sr-only",
                )}
              >
                {group}
              </h2>
              <ul className="space-y-1">
                {items.map((item) => {
                  const Icon = ICONS[item.icon];
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={compact ? item.label : undefined}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-10 items-center rounded-md text-sm font-medium transition-colors",
                          compact ? "justify-center px-2" : "gap-3 px-3",
                          active
                            ? "bg-slate-700 text-white shadow-[inset_3px_0_0_#22d3ee]"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white",
                        )}
                      >
                        <Icon aria-hidden className="size-[18px] shrink-0" />
                        <span className={cn(compact && "sr-only")}>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => onCompactChange(!compact)}
        className={cn(
          "m-3 flex min-h-10 items-center rounded-md border border-slate-700 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white",
          compact ? "justify-center px-2" : "gap-3 px-3",
        )}
        aria-label={compact ? "Perlebar navigasi" : "Padatkan navigasi"}
      >
        {compact ? <PanelLeftOpen aria-hidden className="size-[18px]" /> : <PanelLeftClose aria-hidden className="size-[18px]" />}
        <span className={cn(compact && "sr-only")}>{compact ? "Perlebar" : "Padatkan navigasi"}</span>
      </button>
    </aside>
  );
}
