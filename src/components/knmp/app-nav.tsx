"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/nav";

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex w-max items-center gap-1">
      {items.map((item) => {
        if (!item.ready) {
          return (
            <span
              key={item.href}
              title="Sedang dibangun"
              className="flex cursor-default items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-slate-400"
            >
              {item.label}
              <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                segera
              </span>
            </span>
          );
        }
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition active:scale-[0.98] ${
              active
                ? "bg-[#0F766E] text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
