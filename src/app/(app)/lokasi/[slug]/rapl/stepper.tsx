"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRupiahShort } from "@/lib/format";

/**
 * Tahapan RAPL: Petakan → Setujui → Kebutuhan → Harga (DECISIONS 326).
 *
 * Gunanya bukan hiasan. Sebelumnya satu halaman menumpuk empat tabel dan orang
 * harus menebak sendiri mulai dari mana; sekarang tahap yang perlu dikerjakan
 * ditandai, dan tiap tahap membawa satu angka yang berarti — berapa uraian
 * tersisa DAN berapa rupiah yang tertahan di situ.
 */

export type TahapView = {
  tahap: string;
  judul: string;
  sisa: number;
  selesai: number;
  /** BigInt diserialisasi. */
  nilaiSisa: string;
  aktif: boolean;
  ajakan: string;
};

export function Stepper({ tahapan }: { tahapan: TahapView[] }) {
  const aktif = tahapan.find((t) => t.aktif);
  return (
    <div className="rounded-lg border border-line bg-surface">
      <ol className="grid gap-px bg-line sm:grid-cols-4">
        {tahapan.map((t, i) => {
          const tuntas = t.sisa === 0 && t.selesai > 0;
          return (
            <li
              key={t.tahap}
              className={cn(
                "bg-surface px-3 py-2.5",
                t.aktif && "bg-brand-soft",
              )}
            >
              <p className="flex items-center gap-1.5 text-[12px] font-medium tracking-wide uppercase">
                <span
                  className={cn(
                    "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px]",
                    t.aktif
                      ? "bg-brand text-white"
                      : tuntas
                        ? "bg-success text-white"
                        : "bg-surface-inset text-ink-muted",
                  )}
                >
                  {tuntas && !t.aktif ? <Check aria-hidden className="size-2.5" /> : i + 1}
                </span>
                <span className={t.aktif ? "text-brand" : "text-ink-muted"}>{t.judul}</span>
              </p>
              <p className="tabular mt-1 text-lg font-semibold text-ink">
                {t.sisa > 0 ? t.sisa : t.selesai}
                <span className="ms-1 text-[12px] font-normal text-ink-muted">
                  {t.sisa > 0 ? "tersisa" : "uraian"}
                </span>
              </p>
              {t.sisa > 0 && BigInt(t.nilaiSisa) > 0n ? (
                <p className="tabular text-[12px] text-ink-muted">
                  {formatRupiahShort(BigInt(t.nilaiSisa))} tertahan
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {aktif ? (
        <p className="border-t border-line px-3 py-2 text-[13px] text-ink">
          <span className="font-medium">Sekarang: {aktif.judul}.</span> {aktif.ajakan}
        </p>
      ) : null}
    </div>
  );
}
