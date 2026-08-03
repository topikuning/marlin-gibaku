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
  /**
   * Di ponsel: sembunyikan breadcrumb + eyebrow + deskripsi, kecilkan judul.
   *
   * Untuk halaman yang tugasnya MENGISI, bukan membaca (laporan harian).
   * Di sana tiap baris kepala menggeser kolom pertama turun satu baris lagi,
   * dan mandor harus menggulir sebelum bisa mengetik apa pun. Isinya tidak
   * dihapus dari desktop — cuma tidak dipaksakan ke layar 375px.
   */
  compactMobile?: boolean;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumb,
  className,
  compactMobile = false,
}: PageHeaderProps) {
  const sembunyiDiPonsel = compactMobile ? "max-sm:hidden" : "";
  return (
    <div className={cn(compactMobile ? "mb-3 sm:mb-5" : "mb-5", className)}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav aria-label="Breadcrumb" className={cn("mb-2", sembunyiDiPonsel)}>
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
            <p
              className={cn(
                "text-xs font-medium tracking-wide text-ink-faint uppercase",
                sembunyiDiPonsel,
              )}
            >
              {eyebrow}
            </p>
          ) : null}
          <h1 className={cn("font-semibold text-ink", compactMobile ? "text-base sm:text-xl" : "text-xl")}>
            {title}
          </h1>
          {description ? (
            <div className={cn("mt-1 text-sm text-ink-muted", sembunyiDiPonsel)}>{description}</div>
          ) : null}
        </div>
        {/* BUKAN `shrink-0`: itu memerintahkan blok tombol untuk tidak pernah
            mengecil, sehingga dua tombol beraksara panjang (mis. "Impor batch
            lokasi" + "Paket baru" = 597px) MELEBARKAN SELURUH HALAMAN di layar
            390px — Safari iOS lalu memperkecil seisi halaman supaya muat.
            Karena PageHeader dipakai hampir semua halaman, satu kata ini
            membuat cacat yang sama muncul berulang di mana-mana. DECISIONS 217. */}
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
