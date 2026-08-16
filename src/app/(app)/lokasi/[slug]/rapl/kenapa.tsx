"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Penjelasan yang DILIPAT (DECISIONS 326).
 *
 * Angka RAPL memang perlu dijelaskan — cakupan 72%, "beda tipis", satuan yang
 * tidak sepadan — dan penjelasannya tidak boleh hilang. Tapi menempelkannya
 * sebagai paragraf di setiap sudut membuat pekerjaannya tertutup teks. Di sini
 * penjelasan tetap ada, satu ketukan jauhnya, dan tidak menghalangi.
 */
export function Kenapa({ judul, children }: { judul: string; children: ReactNode }) {
  const [buka, setBuka] = useState(false);
  return (
    <div className="rounded-md border border-line bg-surface-inset">
      <button
        type="button"
        onClick={() => setBuka(!buka)}
        aria-expanded={buka}
        className="flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] text-ink-muted hover:text-ink"
      >
        <HelpCircle aria-hidden className="size-3.5 shrink-0" />
        <span className="flex-1">{judul}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 shrink-0 transition-transform", buka && "rotate-180")}
        />
      </button>
      {buka ? (
        <p className="border-t border-line px-3 py-2.5 text-[13px] leading-relaxed text-ink-muted">
          {children}
        </p>
      ) : null}
    </div>
  );
}
