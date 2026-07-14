"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";

/**
 * Auto-buka dialog print saat mount + tombol "Cetak" manual.
 * Satu-satunya salinan util print — jangan duplikasi di halaman.
 */
export function AutoPrint() {
  useEffect(() => {
    // Tunda satu frame supaya layout selesai render sebelum print.
    const t = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-800"
    >
      <Printer aria-hidden className="size-4" />
      Cetak
    </button>
  );
}
