import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  /** Label kecil di atas judul (mis. kode paket). */
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  /** Slot kanan: tombol aksi halaman. */
  actions?: ReactNode;
  breadcrumb?: BreadcrumbItem[];
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumb,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-5", className)}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] text-ink-muted">
            {breadcrumb.map((item, i) => (
              <li key={`${item.label}-${i}`} className="flex items-center gap-1">
                {i > 0 ? (
                  <ChevronRight aria-hidden className="size-3.5 text-ink-faint" />
                ) : null}
                {item.href ? (
                  <Link href={item.href} className="hover:text-ink hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-ink">
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-bold tracking-[0.14em] text-primary-600 uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-0.5 text-2xl leading-tight font-semibold tracking-tight text-ink lg:text-[28px]">
            {title}
          </h1>
          {description ? (
            <div className="mt-1 text-sm text-ink-muted">{description}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
