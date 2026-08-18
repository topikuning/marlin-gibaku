"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
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

/**
 * Tab navigasi berbasis URL (underline style).
 *
 * ### Kenapa MELEKAT di atas (DECISIONS 354)
 *
 * Keluhan user 2026-08-17 di halaman RAB (903 item): *"scroll ke bawah, kembali
 * ke atas tab menu ringkasan, rab, progress, dll susah untuk discroll aktif di
 * layar"*.
 *
 * Sebelumnya tab ini ikut menggulir pergi. Di halaman panjang, berpindah tab
 * berarti menggulir balik ke paling atas — pada daftar 903 item itu perjalanan
 * yang jauh, dan satu-satunya jalan menuju sembilan halaman lain dari lokasi
 * ini. Navigasi utama yang harus dikejar bukan navigasi.
 *
 * Melekat di bawah topbar (`top-13` = tinggi topbar), bukan di `top-0`: kalau
 * `top-0`, ia bersembunyi DI BALIK topbar yang juga melekat, dan gejalanya
 * justru terlihat seperti tab yang hilang.
 *
 * ### Kenapa tab aktif digulir sendiri ke tengah
 *
 * Deretnya lebih lebar dari layar ponsel. Tanpa ini, membuka tab ke-7 membuat
 * deretnya berhenti di posisi paling kiri — tab yang sedang dibuka tidak
 * terlihat sama sekali, sehingga orang kehilangan jejak posisinya sendiri.
 *
 * Digeser lewat `scrollLeft`, BUKAN `scrollIntoView`: yang terakhir bisa ikut
 * menggeser halaman secara vertikal, dan itu persis gerakan tak terduga yang
 * dikeluhkan.
 */
export function LinkTabs({
  items,
  className,
}: {
  items: LinkTabItem[];
  className?: string;
}) {
  const pathname = usePathname();
  const barisRef = useRef<HTMLUListElement>(null);
  const aktifRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const baris = barisRef.current;
    const aktif = aktifRef.current;
    if (!baris || !aktif) return;
    // Sudah terlihat utuh → jangan digeser. Menggeser yang sudah benar hanya
    // menghasilkan gerakan yang tidak diminta siapa pun.
    const kiri = aktif.offsetLeft;
    const kanan = kiri + aktif.offsetWidth;
    if (kiri >= baris.scrollLeft && kanan <= baris.scrollLeft + baris.clientWidth) return;
    baris.scrollLeft = Math.max(0, kiri - (baris.clientWidth - aktif.offsetWidth) / 2);
  }, [pathname]);

  return (
    <nav
      aria-label="Tab"
      className={cn(
        "sticky top-13 z-10 -mx-4 border-b border-border bg-surface px-4 lg:-mx-6 lg:px-6",
        className,
      )}
    >
      <ul ref={barisRef} className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href} ref={active ? aktifRef : undefined}>
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
