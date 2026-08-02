"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useDismissable } from "@/components/ui";
import { cn } from "@/lib/cn";
import { cariGlobal } from "@/lib/search/actions";
// Dari ./types, BUKAN ./global — modul kueri memakai `server-only` dan tidak
// boleh ikut terseret ke bundel client.
import { KIND_LABEL, MIN_QUERY, type SearchHit } from "@/lib/search/types";

/**
 * Pencarian global (PRD MARLIN P0, FR-NAV-02): cari paket, lokasi, dokumen,
 * vendor dan pengguna dari halaman mana pun — tanpa perlu tahu lebih dulu menu
 * mana yang memuatnya.
 *
 * Bentuknya panel terpusat, bukan kotak teks di topbar: topbar mobile sudah
 * berisi merek + breadcrumb + identitas + tombol keluar, dan menyelipkan input
 * di sana adalah cara paling cepat membuat halaman melebar di layar 375px.
 *
 * Penyaringan capability + scope terjadi SELURUHNYA di server (lib/search).
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Hasil DISIMPAN bersama kuerinya. Tanpa itu, hasil kueri lama tidak bisa
  // dibedakan dari hasil kueri yang sedang diketik — dan yang basi terlanjur
  // tampil sebagai jawaban yang benar.
  const [hasil, setHasil] = useState<{ q: string; hits: SearchHit[] }>({ q: "", hits: [] });
  const [aktif, setAktif] = useState(0);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const tutup = useCallback(() => {
    setOpen(false);
    setQ("");
  }, []);
  const dismiss = useDismissable(open, tutup);

  const s = q.trim();
  const cukup = s.length >= MIN_QUERY;
  // Hasil kueri yang lebih pendek tetap ditampilkan selama kueri baru dalam
  // perjalanan: mengosongkan daftar tiap ketukan tombol membuat panel berkedip
  // sepanjang pengetikan. Yang tidak sepadan (kueri dipersempit lalu dihapus)
  // memang dikosongkan.
  const relevan = hasil.q.length > 0 && s.startsWith(hasil.q);
  const hits = cukup && relevan ? hasil.hits : [];
  const selesai = cukup && hasil.q === s && !pending;

  // Kueri berubah → sorotan kembali ke hasil teratas. Penyesuaian saat render
  // (pola yang sama dgn BottomNav), bukan effect — hindari render kaskade.
  const [prevQ, setPrevQ] = useState(s);
  if (prevQ !== s) {
    setPrevQ(s);
    setAktif(0);
  }

  // Ctrl/Cmd+K dari mana saja.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Tunda 250 ms: mengetik "tengket" tanpa jeda berarti tujuh kueri ke DB, dan
  // enam di antaranya sudah basi sebelum hasilnya sampai.
  useEffect(() => {
    if (!open || !cukup) return;
    const t = setTimeout(() => {
      startTransition(async () => {
        setHasil({ q: s, hits: await cariGlobal(s) });
      });
    }, 250);
    return () => clearTimeout(t);
  }, [s, cukup, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const buka = useCallback(
    (hit: SearchHit) => {
      tutup();
      router.push(hit.href);
    },
    [router, tutup],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAktif((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAktif((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[aktif];
      if (hit) buka(hit);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          dismiss.capture();
          setOpen(true);
        }}
        aria-label="Cari paket, lokasi, dokumen"
        aria-keyshortcuts="Control+K Meta+K"
        className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[13px] font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="hidden sm:inline">Cari</span>
        <kbd className="ml-1 hidden rounded border border-border px-1 text-[10px] text-ink-faint lg:inline">
          Ctrl K
        </kbd>
      </button>

      {open ? (
        <div
          className="no-print fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Pencarian global"
        >
          <button
            type="button"
            aria-label="Tutup pencarian"
            onClick={dismiss.close}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-x-3 top-[10vh] mx-auto max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden className="size-4 shrink-0 text-ink-faint" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded={hits.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={hits[aktif] ? `${listId}-${aktif}` : undefined}
                aria-label="Kata kunci pencarian"
                placeholder="Cari paket, lokasi, dokumen, vendor, pengguna…"
                className="h-12 w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              />
              <button
                type="button"
                aria-label="Tutup"
                onClick={dismiss.close}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              <ul
                id={listId}
                role="listbox"
                aria-label="Hasil pencarian"
                aria-busy={pending}
                className="py-1"
              >
                {hits.map((hit, i) => (
                  <li
                    key={`${hit.kind}-${hit.id}`}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === aktif}
                  >
                    <button
                      type="button"
                      onMouseEnter={() => setAktif(i)}
                      onClick={() => buka(hit)}
                      className={cn(
                        "flex w-full items-baseline gap-2 px-3 py-2 text-left",
                        i === aktif ? "bg-primary-50" : "hover:bg-surface-muted",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {hit.label}
                        </span>
                        {hit.detail ? (
                          <span className="block truncate text-[12px] text-ink-muted">
                            {hit.detail}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                        {KIND_LABEL[hit.kind]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <p aria-live="polite" className="px-3 py-2 text-[12px] text-ink-muted">
                {!cukup
                  ? `Ketik minimal ${MIN_QUERY} huruf.`
                  : hits.length > 0
                    ? `${hits.length} hasil — ↑↓ pilih, Enter buka.`
                    : selesai
                      ? `Tidak ada yang cocok dengan "${s}" pada data yang boleh Anda lihat.`
                      : "Mencari…"}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
