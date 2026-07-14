"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface LinkTabItem {
  label: string;
  href: string;
  /** Cocokkan path persis (default: prefix match). */
  exact?: boolean;
}

function isActive(pathname: string, item: LinkTabItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Tab navigasi berbasis URL (underline style). */
export function LinkTabs({
  items,
  className,
}: {
  items: LinkTabItem[];
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Tab"
      className={cn("border-b border-border", className)}
    >
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                  active
                    ? "border-primary font-semibold text-primary"
                    : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
