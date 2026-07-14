import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-surface-inset text-ink-muted border-border",
  success: "bg-success-soft text-success border-success-border",
  warning: "bg-warning-soft text-warning border-warning-border",
  danger: "bg-danger-soft text-danger border-danger-border",
  info: "bg-info-soft text-info border-info-border",
};

export interface BadgeProps {
  tone?: BadgeTone;
  label?: string;
  children?: ReactNode;
  className?: string;
}

/** Pill status kecil untuk semua status enum. Pakai `label` atau children. */
export function Badge({ tone = "neutral", label, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {label ?? children}
    </span>
  );
}

export const StatusPill = Badge;
