"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * SATU tombol berkas, isinya pilihan cara mengeluarkannya (DECISIONS 334).
 *
 * Keberatan user 2026-08-16: *"laporan 7 harian itu seharusnya satu tombol
 * nanti muncul 3 opsi, kirim wa, kirim google drive, download. itu lebih
 * ringkas. pola itu di tombol lain juga sepertinya lebih oke."*
 *
 * Benar, dan alasannya lebih dalam daripada kerapian: baris tombol yang lama
 * menyusun DUA sumbu jadi satu deret — **berkas apa** (PDF blanko, Excel,
 * berkas mingguan) dan **mau diapakan** (unduh, WhatsApp, Drive). Hasilnya
 * "Kirim ke WhatsApp (PDF) · Excel · Unduh PDF · 7 Laporan Harian · Upload ke
 * Drive (PDF + Excel)" — lima tombol yang tidak sejajar artinya, dan orang
 * harus membacanya satu-satu untuk tahu mana yang berkas dan mana yang tujuan.
 *
 * Di sini sumbunya dipisah: **judul tombol = berkasnya**, isi menu = tujuannya.
 * Menambah tujuan baru nanti tidak menambah tombol.
 *
 * Sengaja `<details>`, bukan popover buatan sendiri: Esc, klik di luar, fokus
 * papan ketik, dan pembaca layar sudah benar tanpa satu baris JS pun. Yang
 * ditambahkan hanya penutupan saat salah satu pilihan ditekan.
 */

export type PilihanBerkas = {
  label: string;
  icon?: ReactNode;
  /** Tautan unduh/cetak. Salah satu dari `href` atau `onSelect` wajib ada. */
  href?: string;
  onSelect?: () => void;
  /** Alasan pilihan ini mati — DITULIS, bukan sekadar diredupkan. */
  disabledReason?: string | null;
  /** Keterangan sebaris di bawah label; dipakai menjelaskan isi berkasnya. */
  hint?: string;
  loading?: boolean;
};

export function MenuBerkas({
  label,
  icon,
  pilihan,
  variant = "secondary",
  className,
}: {
  /** Nama BERKASNYA, bukan tujuannya — mis. "7 Laporan Harian". */
  label: string;
  icon?: ReactNode;
  pilihan: PilihanBerkas[];
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const id = useId();
  const [terbuka, setTerbuka] = useState(false);

  // Klik di luar menutup menu. `<details>` tidak melakukannya sendiri.
  useEffect(() => {
    if (!terbuka) return;
    const luar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setTerbuka(false);
    };
    document.addEventListener("mousedown", luar);
    return () => document.removeEventListener("mousedown", luar);
  }, [terbuka]);

  const tutup = () => setTerbuka(false);

  return (
    <details
      ref={ref}
      open={terbuka}
      onToggle={(e) => setTerbuka((e.currentTarget as HTMLDetailsElement).open)}
      className={cn("relative inline-block", className)}
    >
      <summary
        aria-haspopup="menu"
        className={cn(
          "inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors",
          "[&::-webkit-details-marker]:hidden",
          variant === "primary"
            ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
            : "border-border bg-surface text-ink hover:border-border-strong hover:bg-surface-muted",
        )}
      >
        {icon}
        {label}
        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", terbuka && "rotate-180")} />
      </summary>

      <div
        id={id}
        role="menu"
        className="absolute z-20 mt-1 min-w-60 rounded-md border border-border bg-surface p-1 shadow-lg"
      >
        {pilihan.map((p) => {
          const mati = !!p.disabledReason;
          const isi = (
            <>
              <span className="flex items-center gap-2">
                {p.icon}
                <span className="font-medium">{p.label}</span>
              </span>
              {/* Alasan mati DITULIS. "Redup tanpa keterangan" membuat orang
                  mengira aplikasinya rusak, bukan syaratnya belum terpenuhi. */}
              {p.disabledReason ? (
                <span className="mt-0.5 block text-[11px] text-ink-faint">{p.disabledReason}</span>
              ) : p.hint ? (
                <span className="mt-0.5 block text-[11px] text-ink-muted">{p.hint}</span>
              ) : null}
            </>
          );
          const kelas = cn(
            "block w-full rounded px-2.5 py-1.5 text-start text-[13px]",
            mati ? "cursor-not-allowed text-ink-faint" : "text-ink hover:bg-surface-muted",
          );

          if (mati) {
            return (
              <span key={p.label} role="menuitem" aria-disabled className={kelas}>
                {isi}
              </span>
            );
          }
          if (p.href) {
            return (
              <a
                key={p.label}
                role="menuitem"
                href={p.href}
                target="_blank"
                rel="noopener"
                onClick={tutup}
                className={kelas}
              >
                {isi}
              </a>
            );
          }
          return (
            <button
              key={p.label}
              type="button"
              role="menuitem"
              disabled={p.loading}
              onClick={() => {
                p.onSelect?.();
                tutup();
              }}
              className={kelas}
            >
              {isi}
            </button>
          );
        })}
      </div>
    </details>
  );
}
