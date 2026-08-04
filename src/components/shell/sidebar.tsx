"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Branding } from "@/lib/branding";
import { BrandWordmark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/cn";
import { NavIcon } from "./nav-progress";
import { type NavGroup } from "./nav-config";

/**
 * Menu mana yang sedang terbuka.
 *
 * Pencocokan awalan sengaja TIDAK dipakai untuk butir yang merupakan anak dari
 * butir lain: `/master` dan `/master/pengguna` dua-duanya ada di menu, dan
 * dengan `startsWith` polos keduanya akan menyala bersamaan di `/master/
 * pengguna` — dua sorotan sekaligus membuat "saya di mana" jadi tidak terjawab.
 * Karena itu butir yang lebih spesifik menang: sebuah butir hanya aktif secara
 * awalan bila tidak ada butir lain yang cocok lebih panjang.
 */
function hrefTerpilih(pathname: string, hrefs: string[]): string | null {
  let terbaik: string | null = null;
  for (const href of hrefs) {
    const cocok = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (cocok && (terbaik === null || href.length > terbaik.length)) terbaik = href;
  }
  return terbaik;
}

/** Sidebar desktop (≥lg). Nav sudah difilter capability oleh caller. */
export function Sidebar({ groups, brand }: { groups: NavGroup[]; brand: Branding }) {
  const pathname = usePathname();
  const aktif = hrefTerpilih(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href)),
  );

  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
      <div className="border-b border-border px-4 py-3.5">
        {/* Wordmark resmi menggantikan rakitan "ikon + teks" (DECISIONS 227):
            hurufnya vektor, jadi bentuknya tidak lagi bergantung font UI. */}
        <BrandWordmark tinggi={26} />
        {/* Konteks proyek boleh KOSONG (DECISIONS 228) — jangan sisakan
            paragraf kosong yang menambah jarak tanpa isi. */}
        {brand.projectContext ? (
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-tight text-ink-muted">
            {brand.projectContext}
          </p>
        ) : null}
      </div>
      <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto p-2 pb-4">
        {groups.map((group) => (
          <div key={group.label} className="mt-3.5 first:mt-1">
            {/* Judul grup adalah LABEL, bukan tombol: mengetuknya tidak
                membawa ke mana pun, jadi jangan dibuat menyerupai tautan. */}
            <p className="px-2 pb-1 text-[10px] font-bold tracking-[0.12em] text-ink-faint uppercase">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === aktif;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-primary-50 text-primary"
                          : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                      )}
                    >
                      <NavIcon icon={item.icon} className="size-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
