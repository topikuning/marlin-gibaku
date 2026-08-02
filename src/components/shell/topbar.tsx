import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import type { UserRole } from "@/generated/prisma/enums";
import type { Branding } from "@/lib/branding";
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
  /** Slot kiri: breadcrumb / judul halaman. */
  children?: ReactNode;
}

/** Topbar ringkas (server component). */
export function Topbar({ brand, user, logoutAction, children }: TopbarProps) {
  return (
    <header className="no-print sticky top-0 z-20 flex h-13 items-center justify-between gap-3 border-b border-border bg-surface px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Brand mini utk mobile (sidebar tersembunyi) */}
        <span className="text-sm font-bold tracking-tight text-primary lg:hidden">
          {brand.appName}
        </span>
        <div className="min-w-0 truncate text-sm text-ink-muted">{children}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {/* Pencarian global: ada di SETIAP halaman ber-shell, bukan hanya di
            dashboard eksekutif seperti sebelumnya. */}
        <GlobalSearch />
        {/* Dibatasi + dipotong di layar sempit: nama panjang pernah jadi sumber
            melebarnya topbar, dan sekarang ruangnya berbagi dgn tombol cari. */}
        <div className="max-w-[6.5rem] text-right sm:max-w-none">
          <p className="truncate text-[13px] leading-tight font-medium text-ink">
            {user.fullName}
          </p>
          <p className="truncate text-[11px] leading-tight text-ink-muted">
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
