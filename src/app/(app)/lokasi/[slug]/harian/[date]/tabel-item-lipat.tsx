"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Tabel pekerjaan laporan terkirim dengan baris bervolume 0 DILIPAT di bawahnya
 * (DECISIONS 787). Satu tabel, bukan dua: kolomnya tetap sejajar saat lipatan
 * dibuka. Barisnya disusun server; komponen ini hanya membuka-tutup.
 */
export function TabelItemLipat({
  kepala,
  utama,
  lipat,
  labelLipat,
  kolom,
}: {
  kepala: ReactNode;
  utama: ReactNode[];
  lipat: ReactNode[];
  labelLipat: string;
  kolom: number;
}) {
  const [buka, setBuka] = useState(false);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>{kepala}</thead>
        <tbody className="divide-y divide-border">
          {utama}
          {lipat.length > 0 ? (
            <tr>
              <td colSpan={kolom} className="p-0">
                <button
                  type="button"
                  aria-expanded={buka}
                  onClick={() => setBuka((b) => !b)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink-muted hover:bg-surface-muted"
                >
                  <ChevronRight aria-hidden className={`size-4 shrink-0 transition-transform ${buka ? "rotate-90" : ""}`} />
                  <span>{labelLipat}</span>
                </button>
              </td>
            </tr>
          ) : null}
          {buka ? lipat : null}
        </tbody>
      </table>
    </div>
  );
}
