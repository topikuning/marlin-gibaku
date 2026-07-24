import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-surface shadow-xs",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Slot kanan: tombol/link aksi. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex items-start justify-between gap-3 border-b border-border px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}

/**
 * Kartu yang bisa dilipat (native <details> — tanpa JS klien). Header berfungsi
 * sebagai tombol buka/tutup; isi hanya dirender area saat terbuka. Dipakai untuk
 * panel berat (mis. editor kurva-S) supaya tidak memakan tempat secara default.
 */
export function CollapsibleCard({
  title,
  subtitle,
  defaultOpen = false,
  className,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <details
      className={cn("group rounded-lg border border-border bg-surface shadow-xs", className)}
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-90"
        />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p> : null}
        </div>
      </summary>
      <div className={cn("border-t border-border px-4 py-3", bodyClassName)}>{children}</div>
    </details>
  );
}
