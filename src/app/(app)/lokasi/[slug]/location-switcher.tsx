"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { StatusPill } from "@/components/ui";
import { DeltaBadge } from "@/components/ui/stat-delta";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_TONE } from "@/lib/lifecycle";
import type { LocationStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";

/**
 * Pindah antar lokasi SEPAKET tanpa memutar lewat halaman paket (DECISIONS 204).
 *
 * Yang mahal sebelum ini bukan jumlah kliknya, tapi hilangnya konteks: satu-
 * satunya jalan adalah header → halaman paket → cari lokasi → klik, lalu
 * mendarat di Ringkasan dan harus mencari tab-nya lagi. Padahal pola kerja
 * nyatanya menyapu: memeriksa hal yang SAMA di beberapa lokasi berturut-turut.
 *
 * Karena itu **sub-halaman yang sedang dibuka ikut terbawa** — dari
 * `/lokasi/a/progress` memilih B berarti `/lokasi/b/progress`, bukan
 * `/lokasi/b`. Termasuk tanggal pada `/harian/[date]`: tanggalnya milik
 * kalender, bukan milik lokasi, jadi membandingkan hari yang sama antar-lokasi
 * justru itu yang dicari.
 *
 * Tab yang isinya belum tersedia di lokasi tujuan TETAP dibuka — halamannya
 * sendiri yang menjelaskan kenapa kosong. Melempar diam-diam ke Ringkasan
 * terasa seperti kliknya tidak berfungsi.
 */

export type SiblingLocation = {
  slug: string;
  name: string;
  regency: string;
  status: LocationStatus;
  /** null = belum ada baseline aktif, jadi deviasi belum punya arti. */
  deviationPct: number | null;
};

/** Ambang kotak cari — sama dengan `Combobox` (searchThreshold default 7). */
const AMBANG_CARI = 7;

export function LocationSwitcher({
  current,
  siblings,
  hiddenCount,
  packageName,
}: {
  current: SiblingLocation;
  siblings: SiblingLocation[];
  /** Lokasi sepaket yang TIDAK boleh diakses user ini. */
  hiddenCount: number;
  packageName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const idx = siblings.findIndex((l) => l.slug === current.slug);
  const showSearch = siblings.length > AMBANG_CARI;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return siblings;
    return siblings.filter((l) => `${l.name} ${l.regency}`.toLowerCase().includes(q));
  }, [siblings, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && showSearch) searchRef.current?.focus();
  }, [open, showSearch]);

  /**
   * Ganti HANYA segmen slug; sisa path dipertahankan apa adanya. Seluruh
   * sub-halaman workspace ada di setiap lokasi (`harian/[date]` memakai
   * tanggal, bukan id milik lokasi), jadi tidak ada tautan yang jadi 404.
   */
  function hrefFor(slug: string): string {
    const parts = pathname.split("/");
    // ["", "lokasi", "<slug>", ...sisa]
    if (parts[1] !== "lokasi" || parts.length < 3) return `/lokasi/${slug}`;
    parts[2] = slug;
    return parts.join("/");
  }

  function pindah(slug: string) {
    setOpen(false);
    setQuery("");
    router.push(hrefFor(slug));
  }

  // Satu lokasi saja (atau tak ada yang lain yang boleh diakses) → tidak ada
  // yang bisa dituju; tampilkan judul biasa, jangan kontrol yang tak berguna.
  if (siblings.length <= 1) {
    return <h1 className="text-xl font-semibold text-ink">{current.name}</h1>;
  }

  return (
    <div ref={rootRef} className="relative inline-flex items-center gap-1">
      <h1 className="contents">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={`Pindah ke lokasi lain di ${packageName}`}
          className="inline-flex max-w-[70vw] items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-xl font-semibold text-ink hover:border-border hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary-600 sm:max-w-none"
        >
          <span className="truncate">{current.name}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-faint" />
        </button>
      </h1>

      {/* Panah urut: saat menyapu semua lokasi, tak perlu mengingat mana yang
          sudah dibuka — cukup tekan berikutnya sampai habis. */}
      <StepButton
        label="Lokasi sebelumnya"
        disabled={idx <= 0}
        onClick={() => idx > 0 && pindah(siblings[idx - 1].slug)}
      >
        <ChevronLeft aria-hidden className="size-4" />
      </StepButton>
      <StepButton
        label="Lokasi berikutnya"
        disabled={idx < 0 || idx >= siblings.length - 1}
        onClick={() => idx >= 0 && idx < siblings.length - 1 && pindah(siblings[idx + 1].slug)}
      >
        <ChevronRight aria-hidden className="size-4" />
      </StepButton>

      {open ? (
        <div
          role="listbox"
          aria-label="Pindah lokasi"
          className="absolute top-full left-0 z-30 mt-1.5 w-[min(26rem,85vw)] overflow-hidden rounded-lg border border-border-strong bg-surface shadow-lg"
        >
          <div className="flex justify-between gap-2 border-b border-border bg-surface-muted px-3 py-2 text-[11px] text-ink-muted">
            <span className="truncate">{packageName}</span>
            <span className="shrink-0">{siblings.length} lokasi</span>
          </div>

          {showSearch ? (
            <div className="border-b border-border p-2">
              <div className="relative">
                <Search aria-hidden className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari lokasi…"
                  aria-label="Cari lokasi"
                  className="w-full rounded-md border border-border bg-surface py-1.5 pr-2.5 pl-8 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
                />
              </div>
            </div>
          ) : null}

          <ul className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-[13px] text-ink-muted">
                Tidak ada lokasi yang cocok dengan “{query}”.
              </li>
            ) : (
              filtered.map((l) => {
                const aktif = l.slug === current.slug;
                return (
                  <li key={l.slug}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={aktif}
                      onClick={() => pindah(l.slug)}
                      className={cn(
                        "grid w-full grid-cols-[1fr_auto_auto] items-center gap-2.5 rounded-md px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-primary-600",
                        aktif ? "bg-info-soft" : "hover:bg-surface-inset",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{l.name}</span>
                        <span className="block truncate text-[11px] text-ink-muted">{l.regency}</span>
                      </span>
                      <StatusPill
                        tone={LOCATION_STATUS_TONE[l.status]}
                        label={LOCATION_STATUS_LABEL[l.status]}
                      />
                      {/* Lokasi tanpa baseline TIDAK ditulis 0% — 0% terbaca
                          "tidak ada progres", padahal rencananya yang belum ada. */}
                      {l.deviationPct === null ? (
                        <span className="text-[11px] whitespace-nowrap text-ink-faint">belum ada rencana</span>
                      ) : (
                        <DeltaBadge value={l.deviationPct} />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <div className="border-t border-border bg-surface-muted px-3 py-1.5 text-[11px] text-ink-muted">
            {/* Yang disembunyikan disebut jumlahnya: "tidak muncul" tidak boleh
                terbaca "tidak ada" (aturan daftar bersumber data, CLAUDE.md). */}
            {hiddenCount > 0
              ? `${hiddenCount} lokasi lain di paket ini tidak ditampilkan karena di luar penugasan Anda.`
              : "Halaman yang sedang dibuka ikut terbawa ke lokasi yang dipilih."}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-ink-muted"
    >
      {children}
    </button>
  );
}
