import { cn } from "@/lib/cn";
import { formatPct } from "@/lib/format";
import { tingkatDeviasi, type TingkatDeviasi } from "@/lib/deviasi";

/**
 * Ambang deviasi progress (realisasi − rencana, poin %) kini tinggal di
 * `@/lib/deviasi` — satu tempat yang bisa dibaca kode server maupun client.
 * Di sini hanya di-ekspor ulang supaya pemanggil lama tidak perlu berubah.
 */
export { DEVIATION_THRESHOLDS } from "@/lib/deviasi";

export type DeviationTone = "success" | "warning" | "danger";

const TONE_DARI_TINGKAT: Record<TingkatDeviasi, DeviationTone> = {
  aman: "success",
  perhatian: "warning",
  kritis: "danger",
};

export function deviationTone(value: number): DeviationTone {
  return TONE_DARI_TINGKAT[tingkatDeviasi(value)];
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
