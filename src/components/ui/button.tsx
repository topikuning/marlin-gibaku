"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * KONTRAK TOMBOL (Design System §3 · Master Prompt §15.1).
 *
 * Satu primary per kelompok aksi. Aksi yang sama memakai varian yang sama di
 * seluruh produk — kalau "Setujui" hijau di satu layar dan navy di layar lain,
 * warna berhenti berarti apa pun dan pengguna harus membaca tiap tombol.
 *
 *   primary       aksi utama layar (navy)
 *   secondary     aksi pendamping
 *   ghost         aksi tersier / toolbar
 *   success       KEPUTUSAN POSITIF yang mengubah status (Setujui, Finalkan)
 *   danger        destruktif yang sudah dikonfirmasi (Hapus)
 *   dangerOutline penolakan / destruktif yang masih bisa dibatalkan (Tolak)
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "dangerOutline"
  | "success"
  | "ghost";

/**
 * Ukuran. `md` (36px) baku; `sm` (32px) untuk toolbar dan sel tabel; `lg`
 * (44px) WAJIB untuk aksi utama form di ponsel — target sentuh di bawah 44px
 * tidak nyaman dipakai satu tangan sambil berdiri di lapangan.
 */
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Tampilkan spinner + disable tombol. */
  loading?: boolean;
  /**
   * ALASAN tombol dimatikan. Tombol mati tanpa keterangan adalah jalan buntu:
   * pengguna melihat aksi yang jelas ada tetapi tidak tahu apa yang kurang.
   * Teks ini jadi `title` sekaligus `aria-describedby`-nya lewat `aria-label`
   * gabungan, jadi terbaca pembaca layar, bukan cuma muncul saat hover.
   */
  disabledReason?: string;
  children: ReactNode;
}

// State jelas per varian (audit UI #8): default → hover (warna beda) → active
// (ditekan) → disabled. `transition-colors` di base membuat perpindahan halus.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-800 active:bg-primary-900 disabled:bg-primary/60 border border-transparent",
  secondary:
    "bg-surface text-ink border border-border hover:bg-surface-muted hover:border-border-strong active:bg-surface-inset disabled:text-ink-faint disabled:bg-surface",
  danger:
    "bg-danger text-white hover:bg-danger/90 active:bg-danger/80 disabled:bg-danger/60 border border-transparent",
  dangerOutline:
    "bg-surface text-danger border border-danger-border hover:bg-danger-soft active:bg-danger-soft disabled:text-danger/50 disabled:bg-surface",
  success:
    "bg-success text-white hover:bg-success/90 active:bg-success/80 disabled:bg-success/60 border border-transparent",
  ghost:
    "bg-transparent text-ink-muted hover:bg-surface-inset hover:text-ink active:bg-surface-muted border border-transparent",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  disabledReason,
  className,
  children,
  type = "button",
  title,
  ...rest
}: ButtonProps) {
  const mati = disabled || loading;
  return (
    <button
      type={type}
      disabled={mati}
      // Alasan hanya relevan saat tombolnya memang mati — menempelkannya pada
      // tombol aktif membuat tooltip yang membingungkan.
      title={mati && disabledReason ? disabledReason : title}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap select-none transition-colors disabled:cursor-not-allowed",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
      {children}
      {mati && disabledReason ? <span className="sr-only"> — {disabledReason}</span> : null}
    </button>
  );
}

/**
 * Kelas visual tombol — dipakai bersama `Button` dan `ButtonLink`.
 *
 * Diekspor supaya elemen yang HARUS berupa `<a>` (unduhan, navigasi) tetap
 * tampil identik dengan tombol, tanpa menyalin kelas ke tiap halaman. Sebelum
 * ini primitifnya tidak ada, jadi aksi seperti "Unduh Excel" dan "Impor HPS"
 * berakhir sebagai teks biru bergaris bawah di antara judul kartu — kelihatan
 * seperti keterangan, bukan seperti sesuatu yang bisa ditekan. DECISIONS 232.
 */
export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap select-none transition-colors disabled:cursor-not-allowed",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    className,
  );
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  /**
   * Unduhan / rute non-Next (mis. route handler yang mengalirkan berkas).
   * `next/link` mem-prefetch dan menangani navigasi di klien — keduanya salah
   * untuk unduhan, jadi jalur itu memakai `<a>` biasa.
   */
  unduhan?: boolean;
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "sm",
  className,
  children,
  unduhan = false,
  ...rest
}: ButtonLinkProps) {
  const kelas = buttonClass(variant, size, className);
  if (unduhan) {
    // `data-unduhan` dibaca bar progres navigasi (shell/nav-progress.tsx).
    // Mengunduh TIDAK mengganti halaman, jadi tanpa penanda ini barnya menyala
    // lalu menggantung — tidak ada pergantian pathname yang mematikannya.
    return (
      <a href={href} data-unduhan="" className={kelas} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={kelas} {...rest}>
      {children}
    </Link>
  );
}
