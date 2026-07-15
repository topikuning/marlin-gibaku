"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * Toolbar halaman cetak (disembunyikan saat print via `no-print`).
 * TIDAK memicu window.print() otomatis — dulu auto-print membuat pengguna
 * "terjebak" di halaman cetak & harus menekan Back browser. Kini ada tombol
 * Kembali + Cetak eksplisit.
 */
export function PrintToolbar({ backHref }: { backHref?: string }) {
  const router = useRouter();
  return (
    <div className="no-print sticky top-0 z-10 mb-4 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2.5">
      <button
        type="button"
        onClick={() => (backHref ? router.push(backHref) : router.back())}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-muted hover:border-border-strong active:bg-surface-inset"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Kembali
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-800 active:bg-primary-900"
      >
        <Printer aria-hidden className="size-4" />
        Cetak / Simpan PDF
      </button>
    </div>
  );
}
