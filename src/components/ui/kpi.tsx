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
      <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </p>
      <p className={cn("tabular mt-1 text-2xl font-semibold", VALUE_TONE[tone])}>
        {value}
      </p>
      {sub ? <div className="mt-1 text-[13px] text-ink-muted">{sub}</div> : null}
    </>
  );

  const base = cn(
    "block rounded-lg border border-border bg-surface px-4 py-3 shadow-xs",
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
