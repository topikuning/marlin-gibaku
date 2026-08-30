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
 *
 * Sejak 2026-08-30 pemicunya berupa TAUTAN sebaris, bukan bilah abu-abu
 * selebar halaman. Bilahnya menuntut ±38px dan berat visual sebuah kartu untuk
 * memuat satu kalimat yang tertutup — di layar RAPL ada tiga di antaranya, dan
 * bersama kartu-kartu ringkasan ia ikut mendorong tabel ke bawah lipatan.
 */
export function Kenapa({ judul, children }: { judul: string; children: ReactNode }) {
  const [buka, setBuka] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setBuka(!buka)}
        aria-expanded={buka}
        className="inline-flex items-center gap-1.5 text-start text-[13px] text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
      >
        <HelpCircle aria-hidden className="size-3.5 shrink-0" />
        <span>{judul}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 shrink-0 transition-transform", buka && "rotate-180")}
        />
      </button>
      {buka ? (
        <p className="mt-1.5 rounded-md border border-line bg-surface-inset px-3 py-2.5 text-[13px] leading-relaxed text-ink-muted">
          {children}
        </p>
      ) : null}
    </div>
  );
}
