import { LogOut } from "lucide-react";
import { PemasangAplikasi } from "@/components/pwa/pemasang-aplikasi";
import type { ReactNode } from "react";
import type { UserRole } from "@/generated/prisma/enums";
import type { Branding } from "@/lib/branding";
import { BrandWordmark } from "@/components/ui/brand-mark";
import { can, ROLE_LABEL } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { CariCepat } from "./cari-cepat";
import { LATAR_PENANDA, LencanaLingkungan } from "./penanda-lingkungan";

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
  /** Label server non-produksi (DECISIONS 640). `null` = produksi. */
  penanda?: string | null;
}

/** Topbar ringkas (server component). */
export function Topbar({ brand, user, logoutAction, children, penanda }: TopbarProps) {
  return (
    <header
      className={cn(
        // Tinggi + bantalan atas ikut `safe-area-inset-top` (0 di peramban
        // biasa): di aplikasi terpasang kepala ini tidak boleh masuk ke bawah
        // status bar. Isinya tetap setinggi 3,25rem.
        "no-print sticky top-0 z-20 flex h-[calc(3.25rem+env(safe-area-inset-top))] items-center justify-between gap-3 border-b px-4 pt-[env(safe-area-inset-top)] lg:px-6",
        // Server uji: kepala bergaris kuning – lengket, jadi tetap terlihat di
        // halaman mana pun dan sejauh apa pun digulir (DECISIONS 640).
        penanda ? cn(LATAR_PENANDA, "border-b-2 border-warning") : "border-border bg-surface",
      )}
    >
      {/* Kiri tidak pernah menciut: isinya kecil (logo, lencana server uji),
          dan yang mengalah saat sempit adalah nama pengguna di kanan. */}
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {/* Brand mini utk mobile (sidebar tersembunyi) */}
        <span className="flex shrink-0 items-center lg:hidden">
          <BrandWordmark tinggi={18} />
        </span>
        {penanda ? <LencanaLingkungan label={penanda} /> : null}
        <div className="min-w-0 truncate text-sm text-ink-muted">{children}</div>
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* ⌘K / Ctrl+K – pindah lokasi/paket dari halaman mana pun (DECISIONS 684). */}
        {can(user.role, "location.view") || can(user.role, "package.view") ? <CariCepat /> : null}
        {/* Jalan pasang PERMANEN (DECISIONS 405): banner boleh ditutup 14 hari,
            tombol ini tidak ikut diredam. Menyaring dirinya sendiri – hanya
            terbit bila peramban memang menawarkan dan belum terpasang. */}
        <PemasangAplikasi varian="ringkas" />
        {/* Di ponsel nama dipotong supaya tombol cari muat tanpa menimpa
            lencana server uji; nama lengkapnya tetap di `title`. */}
        <div className="min-w-0 text-right" title={user.fullName}>
          <p className="truncate text-[13px] leading-tight font-medium text-ink">
            {user.fullName}
          </p>
          <p className="truncate text-[11px] leading-tight text-ink-muted">
            {ROLE_LABEL[user.role]}
          </p>
        </div>
        <form action={logoutAction} className="shrink-0">
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
