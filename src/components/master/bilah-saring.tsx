"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Button, Combobox } from "@/components/ui";

/**
 * BILAH SARING daftar master data — cari + saringan + reset (DECISIONS 359).
 *
 * Diadopsi dari rancangan user 2026-08-18.
 *
 * ### Reset SELALU ada, dan menyebut apa yang sedang menyaring
 *
 * Daftar yang tersaring terlihat persis seperti daftar yang kosong. Tanpa jalan
 * pulang yang jelas, orang menyimpulkan datanya hilang — dan itu keluhan yang
 * mahal untuk dibantah. Karena itu tombol reset baru muncul KETIKA ada yang
 * menyaring, dan jumlah hasilnya selalu disebut bersama penyebutnya.
 */

export type OpsiSaring = { nilai: string; label: string };

export function BilahSaring({
  cari,
  onCari,
  petunjukCari = "Cari…",
  saringan = [],
  tampil,
  total,
  satuan,
  aksi,
}: {
  cari: string;
  onCari: (v: string) => void;
  petunjukCari?: string;
  saringan?: {
    id: string;
    label: string;
    nilai: string;
    onUbah: (v: string) => void;
    opsi: OpsiSaring[];
  }[];
  /** Jumlah baris yang lolos saringan. */
  tampil: number;
  /** Jumlah seluruh baris — penyebut yang membuat `tampil` bisa dinilai. */
  total: number;
  satuan: string;
  aksi?: ReactNode;
}) {
  const adaSaringan = cari.trim() !== "" || saringan.some((s) => s.nilai !== "");

  return (
    <div className="space-y-2 border-b border-border p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor="ms-cari" className="sr-only">
            {petunjukCari}
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-faint"
            />
            <input
              id="ms-cari"
              value={cari}
              onChange={(e) => onCari(e.target.value)}
              placeholder={petunjukCari}
              /* text-base di ponsel: iOS memperbesar halaman kalau font input
                 di bawah 16px, dan pembesaran itu merusak tata letak (pola yang
                 sama dengan MarlinGrid, DECISIONS 217). */
              className="h-9 w-full rounded-md border border-border bg-surface pl-8 text-base outline-none placeholder:text-ink-faint focus:border-border-strong sm:text-sm"
            />
          </div>
        </div>
        {aksi ? <div className="flex flex-wrap gap-1.5">{aksi}</div> : null}
      </div>

      {saringan.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {saringan.map((s) => (
            <div key={s.id}>
              <label htmlFor={s.id} className="sr-only">
                {s.label}
              </label>
              {/* Combobox, BUKAN <select> native — aturan proyek (DECISIONS
                  094/115/174), dan ia bisa diketik-cari saat opsinya banyak. */}
              <Combobox
                id={s.id}
                value={s.nilai}
                onChange={s.onUbah}
                placeholder={s.label}
              >
                <option value="">{s.label}</option>
                {s.opsi.map((o) => (
                  <option key={o.nilai} value={o.nilai}>
                    {o.label}
                  </option>
                ))}
              </Combobox>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] text-ink-muted">
          Menampilkan <span className="font-semibold text-ink">{tampil}</span> dari {total} {satuan}
        </p>
        {adaSaringan ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onCari("");
              saringan.forEach((s) => s.onUbah(""));
            }}
          >
            <X aria-hidden className="size-3.5" />
            Reset saringan
          </Button>
        ) : null}
      </div>
    </div>
  );
}
