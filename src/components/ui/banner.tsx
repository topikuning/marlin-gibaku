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
  /**
   * Slot kanan: satu tombol/tautan yang MEMBAWA orang ke tempat masalahnya
   * diperiksa.
   *
   * Peringatan tanpa jalan keluar adalah peringatan yang dibaca sekali lalu
   * diabaikan selamanya – terutama peringatan yang muncul di setiap kunjungan,
   * seperti selisih kontrak vs RAB. Slot ini menjadikannya titik awal, bukan
   * hiasan.
   */
  action?: ReactNode;
  className?: string;
}

/** Banner hasil aksi (sukses/gagal server action, peringatan, info). */
export function Banner({ tone, title, description, action, className }: BannerProps) {
  const t = TONE[tone];
  const IconCmp = t.icon;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        // flex-wrap: di ponsel tombol aksi turun ke baris berikutnya, bukan
        // memeras kalimatnya sampai tinggal beberapa huruf per baris.
        "flex flex-wrap items-start gap-2.5 rounded-md border px-3.5 py-3",
        t.wrap,
        className,
      )}
    >
      <IconCmp aria-hidden className={cn("mt-0.5 size-4 shrink-0", t.icon_)} />
      <div className="min-w-[12rem] flex-1 text-sm">
        <p className="font-semibold text-ink">{title}</p>
        {description ? (
          <div className="mt-0.5 text-[13px] text-ink-muted">{description}</div>
        ) : null}
      </div>
      {action ? <div className="min-w-0">{action}</div> : null}
    </div>
  );
}
