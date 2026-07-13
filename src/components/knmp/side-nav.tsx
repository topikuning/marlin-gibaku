"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/nav";

/** Ikon garis sederhana per menu (enterprise, tanpa lib ikon). */
function Icon({ label }: { label: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const path: Record<string, React.ReactNode> = {
    Beranda: <path d="M3 10.5 12 3l9 7.5V21H3z" />,
    Peta: (
      <>
        <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" />
        <circle cx="12" cy="11" r="2" />
      </>
    ),
    Lokasi: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5z" />
        <path d="m3 13 9 5 9-5" />
      </>
    ),
    Laporan: (
      <>
        <rect x="6" y="4" width="12" height="16" rx="1.5" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    "Lapor Harian": (
      <>
        <rect x="6" y="4" width="12" height="16" rx="1.5" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    Pengadaan: (
      <>
        <path d="M6 6h15l-1.5 8H8z" />
        <circle cx="9" cy="19" r="1.4" />
        <circle cx="18" cy="19" r="1.4" />
        <path d="M6 6 5 3H3" />
      </>
    ),
    Kontrak: (
      <>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v4h4M10 13h5M10 16h5" />
      </>
    ),
    Pengguna: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 0 0 0-6M21 20a6 6 0 0 0-4-5.6" />
      </>
    ),
    Diagnostik: <path d="M3 12h4l2 6 4-14 2 8h6" />,
    Keuangan: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 9v6M18 9v6" />
      </>
    ),
  };
  return <svg {...common}>{path[label] ?? <circle cx="12" cy="12" r="8" />}</svg>;
}

export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-[#0F766E]/10 text-[#0F766E]"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <span className={active ? "text-[#0F766E]" : "text-slate-400"}>
              <Icon label={item.label} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
