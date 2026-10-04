"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/**
 * Pencarian cepat lokasi/proyek — ketik nama, pilih dari dropdown, langsung ke
 * workspace lokasi. Client-only, difilter di memori dari indeks lokasi.
 *
 * Daftar hasil menempel ke tepi KIRI kotak selama kepala dasbor bertumpuk
 * (di bawah `xl`), dan ke tepi kanan hanya saat kotak ini ada di kanan kepala.
 * Dulu selalu `right-0` + lebar tetap 256px: di HP kotaknya di kiri dan lebih
 * sempit dari daftarnya, jadi daftar meluber keluar layar dan awal nama lokasi
 * terpotong (keluhan user 2026-10-04).
 *
 * Hasil TIDAK dipotong di 8: lokasi paling banyak ratusan, daftarnya bisa
 * digulir, dan hasil yang hilang diam-diam terbaca "lokasinya tidak ada"
 * (DECISIONS 648).
 */
export function DashboardSearch({ locations }: { locations: { name: string; slug: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const kata = s.split(/\s+/);
    return locations.filter((l) => kata.every((k) => l.name.toLowerCase().includes(k)));
  }, [q, locations]);

  const go = (slug: string) => {
    setOpen(false);
    setQ("");
    router.push(`/lokasi/${slug}`);
  };

  return (
    <div className="relative w-full sm:w-auto">
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus-within:border-border-strong">
        <Search aria-hidden className="size-4 shrink-0 text-ink-faint" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) go(results[0].slug);
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Cari lokasi / proyek…"
          className="w-full bg-transparent text-ink placeholder:text-ink-muted focus:outline-none sm:w-48"
          aria-label="Cari lokasi atau proyek"
        />
      </div>
      {open && results.length > 0 ? (
        <ul className="absolute left-0 z-[1100] mt-1 max-h-72 w-full overflow-auto sm:w-64 xl:right-0 xl:left-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          {results.map((l) => (
            <li key={l.slug}>
              <button
                type="button"
                onMouseDown={() => go(l.slug)}
                className="block w-full truncate px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-muted"
              >
                {l.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
