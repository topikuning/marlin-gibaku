"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface LinkTabItem {
  label: string;
  href: string;
  /** Cocokkan path persis (default: prefix match). */
  exact?: boolean;
  /**
   * Path lain yang DIMILIKI tab ini, selain `href`.
   *
   * Dipakai saat satu tab konseptual menaungi beberapa route — mis.
   * "Pelaksanaan" menaungi laporan harian DAN kegiatan lapangan. Tanpa ini,
   * membuka route saudaranya membuat seluruh baris tab kehilangan sorotan,
   * sehingga pengguna kehilangan jawaban "saya sedang di bagian mana".
   */
  juga?: string[];
  /**
   * Paksa keadaan aktif, mengabaikan pencocokan path.
   *
   * Dipakai tab yang dibedakan QUERY PARAM, bukan path — mis. mode kerja
   * halaman Progress (`?mode=tertinggal`). Pencocokan di bawah hanya melihat
   * pathname, jadi tiga tab ber-path sama akan selamanya menyorot yang pertama.
   *
   * Sengaja prop, bukan `useSearchParams()` di dalam sini: LinkTabs dipakai di
   * belasan halaman, dan menambah hook itu memaksa SEMUANYA ikut menanggung
   * syarat render dinamis demi kebutuhan satu halaman. Yang tahu mode aktif
   * adalah halamannya sendiri, dan ia sudah membacanya di server.
   */
  aktif?: boolean;
}

function cocok(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isActive(pathname: string, item: LinkTabItem): boolean {
  if (item.aktif !== undefined) return item.aktif;
  if (cocok(pathname, item.href, item.exact)) return true;
  return (item.juga ?? []).some((h) => cocok(pathname, h));
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
