"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/nav";

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {items.map((item) => {
        if (!item.ready) {
          return (
            <span
              key={item.href}
              title="Sedang dibangun"
              className="cursor-default rounded-md px-3 py-1.5 text-sm text-[#b3b0a6]"
            >
              {item.label}
              <span className="ml-1 rounded bg-[#EFE9DB] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#94886b]">
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
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-[#3A4E63] text-white"
                : "text-[#3A4E63] hover:bg-[#EFE9DB]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
