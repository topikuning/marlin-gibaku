import { cn } from "@/lib/cn";
import { formatPct } from "@/lib/format";

/**
 * SATU-SATUNYA tempat threshold deviasi progress (realisasi - rencana, poin %).
 * ≥ -1 hijau (on track), ≥ -10 amber (perlu perhatian), < -10 merah (kritis).
 */
export const DEVIATION_THRESHOLDS = {
  /** Deviasi ≥ nilai ini = hijau. */
  onTrack: -1,
  /** Deviasi ≥ nilai ini (dan < onTrack) = amber. Di bawahnya = merah. */
  warning: -10,
} as const;

export type DeviationTone = "success" | "warning" | "danger";

export function deviationTone(value: number): DeviationTone {
  if (value >= DEVIATION_THRESHOLDS.onTrack) return "success";
  if (value >= DEVIATION_THRESHOLDS.warning) return "warning";
  return "danger";
}

const TONE_CLASS: Record<DeviationTone, string> = {
  success: "bg-success-soft text-success border-success-border",
  warning: "bg-warning-soft text-warning border-warning-border",
  danger: "bg-danger-soft text-danger border-danger-border",
};

export interface DeltaBadgeProps {
  /** Deviasi dalam poin persen (mis. -3.2). */
  value: number;
  className?: string;
}

/** Badge deviasi berwarna sesuai DEVIATION_THRESHOLDS. */
export function DeltaBadge({ value, className }: DeltaBadgeProps) {
  const tone = deviationTone(value);
  return (
    <span
      className={cn(
        "tabular inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {value > 0 ? "+" : ""}
      {formatPct(value)}
    </span>
  );
}
