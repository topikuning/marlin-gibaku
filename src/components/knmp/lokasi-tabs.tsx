"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type LokasiTab = { href: string; label: string; exact?: boolean };

/** Sub-navigasi workspace lokasi — selalu terlihat, 1 klik antar fitur. */
export function LokasiTabs({ tabs }: { tabs: LokasiTab[] }) {
  const path = usePathname();
  return (
    <nav className="mb-6 -mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const active = t.exact ? path === t.href : path === t.href || path.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
              active
                ? "border-[#1e3a8a] text-[#1e3a8a]"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
