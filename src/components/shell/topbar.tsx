import { Bell, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { UserRole } from "@/generated/prisma/enums";
import type { Branding } from "@/lib/branding";
import { BrandWordmark } from "@/components/ui/brand-mark";
import { ROLE_LABEL } from "@/lib/authz";
import { GlobalSearch } from "./global-search";

export interface TopbarUser {
  fullName: string;
  role: UserRole;
}

export interface TopbarProps {
  brand: Branding;
  user: TopbarUser;
  /** Server action logout — dipanggil via <form action>. */
  logoutAction: (formData: FormData) => Promise<void>;
  /**
   * Jumlah item di antrean Perlu Tindakan. `null` = pengguna tidak berhak
   * melihat antrean, jadi loncengnya tidak ditampilkan sama sekali — lencana
   * "0" pada lonceng yang tak bisa dibuka hanya menimbulkan pertanyaan.
   */
  jumlahTindakan?: number | null;
  /** Slot kiri: breadcrumb / judul halaman. */
  children?: ReactNode;
}

/** Topbar ringkas (server component). */
export function Topbar({
  brand,
  user,
  logoutAction,
  jumlahTindakan = null,
  children,
}: TopbarProps) {
  return (
    <header className="no-print sticky top-0 z-20 flex h-13 items-center justify-between gap-3 border-b border-border bg-surface px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Brand mini utk mobile (sidebar tersembunyi) */}
        <span className="flex shrink-0 items-center lg:hidden">
          <BrandWordmark tinggi={18} />
        </span>
        <div className="min-w-0 truncate text-sm text-ink-muted">{children}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <GlobalSearch />
        {jumlahTindakan !== null ? (
          <Link
            href="/tindakan"
            aria-label={
              jumlahTindakan > 0
                ? `Perlu Tindakan — ${jumlahTindakan} item menunggu`
                : "Perlu Tindakan — tidak ada yang menunggu"
            }
            className="relative flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            <Bell aria-hidden className="size-4" />
            {jumlahTindakan > 0 ? (
              /* Angka ditulis, bukan sekadar titik: "ada sesuatu" tanpa
                 besarannya tidak membantu memutuskan kapan harus dibuka. */
              <span className="bg-brand-red absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-surface px-1 text-[10px] font-bold text-white tabular-nums">
                {jumlahTindakan > 99 ? "99+" : jumlahTindakan}
              </span>
            ) : null}
          </Link>
        ) : null}
        <div className="hidden text-right sm:block">
          <p className="text-[13px] leading-tight font-medium text-ink">
            {user.fullName}
          </p>
          <p className="text-[11px] leading-tight text-ink-muted">
            {ROLE_LABEL[user.role]}
          </p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            aria-label="Keluar"
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[13px] font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            <LogOut aria-hidden className="size-4" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        </form>
      </div>
    </header>
  );
}
