"use client";

import { useEffect } from "react";

/** Munculkan dialog cetak otomatis saat halaman siap. */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="fixed right-4 top-4 rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white shadow print:hidden"
    >
      Cetak
    </button>
  );
}
