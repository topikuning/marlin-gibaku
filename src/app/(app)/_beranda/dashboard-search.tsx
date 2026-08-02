"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/**
 * Pencarian cepat lokasi/proyek — ketik nama, pilih dari dropdown, langsung ke
 * workspace lokasi. Client-only, difilter di memori dari indeks lokasi.
 */
export function DashboardSearch({ locations }: { locations: { name: string; slug: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return locations.filter((l) => l.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, locations]);

  const go = (slug: string) => {
    setOpen(false);
    setQ("");
    router.push(`/lokasi/${slug}`);
  };

  return (
    <div className="relative">
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
          className="w-40 bg-transparent text-ink placeholder:text-ink-muted focus:outline-none sm:w-48"
          aria-label="Cari lokasi atau proyek"
        />
      </div>
      {open && results.length > 0 ? (
        <ul className="absolute right-0 z-[1100] mt-1 max-h-72 w-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg">
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
