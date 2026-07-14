import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BannerTone = "success" | "error" | "warning" | "info";

const TONE: Record<
  BannerTone,
  { icon: LucideIcon; wrap: string; icon_: string }
> = {
  success: {
    icon: CheckCircle2,
    wrap: "bg-success-soft border-success-border",
    icon_: "text-success",
  },
  error: {
    icon: XCircle,
    wrap: "bg-danger-soft border-danger-border",
    icon_: "text-danger",
  },
  warning: {
    icon: AlertTriangle,
    wrap: "bg-warning-soft border-warning-border",
    icon_: "text-warning",
  },
  info: {
    icon: Info,
    wrap: "bg-info-soft border-info-border",
    icon_: "text-info",
  },
};

export interface BannerProps {
  tone: BannerTone;
  title: string;
  description?: ReactNode;
  className?: string;
}

/** Banner hasil aksi (sukses/gagal server action, peringatan, info). */
export function Banner({ tone, title, description, className }: BannerProps) {
  const t = TONE[tone];
  const IconCmp = t.icon;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-2.5 rounded-md border px-3.5 py-3", t.wrap, className)}
    >
      <IconCmp aria-hidden className={cn("mt-0.5 size-4 shrink-0", t.icon_)} />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-ink">{title}</p>
        {description ? (
          <div className="mt-0.5 text-[13px] text-ink-muted">{description}</div>
        ) : null}
      </div>
    </div>
  );
}
