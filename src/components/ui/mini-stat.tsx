import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Angka kecil DI DALAM kartu – bukan KPI halaman (DECISIONS 386).
 *
 * `KpiCard` sengaja menonjol karena ia ringkasan halaman. Angka pendamping di
 * dalam sebuah kartu (tanggal kontrak, komponen rekonsiliasi, jumlah dokumen
 * terlambat) tidak boleh setebal itu: kalau semuanya menonjol, tidak ada yang
 * menonjol, dan mata kehilangan urutan bacanya.
 *
 * Dipisah jadi primitif karena bentuk yang sama muncul di Ringkasan, Kontrak,
 * dan panel kepatuhan – tiga tempat yang, kalau ditulis sendiri-sendiri, akan
 * berbeda tipis satu sama lain tanpa alasan.
 */
export function MiniStat({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-md border border-border px-2.5 py-2", className)}>
      <p className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">{label}</p>
      <p className="tabular mt-0.5 text-[13px] font-semibold break-words text-ink">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{sub}</p> : null}
    </div>
  );
}
