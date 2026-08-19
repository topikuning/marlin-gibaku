import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type KpiTone = "default" | "success" | "warning" | "danger";

const VALUE_TONE: Record<KpiTone, string> = {
  default: "text-ink",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Keterangan kecil di bawah value (mis. delta, konteks). */
  sub?: ReactNode;
  tone?: KpiTone;
  /** Bila diisi, seluruh kartu jadi link. */
  href?: string;
  className?: string;
}

/**
 * Kartu angka ringkas (DECISIONS 361).
 *
 * Keberatan user 2026-08-18: *"kotak/card itu terlalu besar, kurang compact.
 * itu di semua menu."* Betul, dan ongkosnya nyata: baris KPI yang tinggi
 * mendorong DAFTARNYA — yang sebenarnya dicari orang — turun ke bawah lipatan,
 * di setiap halaman, setiap kali dibuka. Ia ringkasan, bukan judul halaman.
 *
 * Ukurannya diperkecil di primitifnya, bukan di tiap halaman: ada 89 pemakaian
 * di 22 berkas, dan menyetelnya satu per satu berarti 22 kesempatan untuk
 * berbeda sendiri.
 */
export function KpiCard({
  label,
  value,
  sub,
  tone = "default",
  href,
  className,
}: KpiCardProps) {
  const inner = (
    <>
      <p className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </p>
      <p className={cn("tabular mt-0.5 text-xl leading-tight font-semibold", VALUE_TONE[tone])}>
        {value}
      </p>
      {sub ? <div className="mt-0.5 text-[11px] leading-snug text-ink-muted">{sub}</div> : null}
    </>
  );

  const base = cn(
    "block rounded-lg border border-border bg-surface px-3 py-2 shadow-xs",
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(base, "transition-colors hover:border-border-strong hover:bg-surface-muted")}
      >
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}
