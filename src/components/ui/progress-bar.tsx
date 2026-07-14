import { cn } from "@/lib/cn";

export type ProgressTone = "primary" | "success" | "warning" | "danger";

const TONE_CLASS: Record<ProgressTone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export interface ProgressBarProps {
  /** 0–100; di-clamp otomatis. */
  value: number;
  tone?: ProgressTone;
  /** Label a11y, mis. "Progress fisik". */
  label?: string;
  className?: string;
}

/** Bar progress murni presentasional — penentuan tone di caller. */
export function ProgressBar({
  value,
  tone = "primary",
  label,
  className,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-inset", className)}
    >
      <div
        className={cn("h-full rounded-full", TONE_CLASS[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
