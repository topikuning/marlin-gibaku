"use client";

import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { cariGlobal } from "@/lib/search-action";
import { LABEL_JENIS_HASIL, MIN_HURUF_CARI, type HasilCari } from "@/lib/search";

/**
 * Pencarian global — tersedia di SETIAP halaman ber-shell (PRD gap P0).
 *
 * Dibuat berpasangan dengan `lib/search.ts`: penyaringan hak akses terjadi di
 * server, komponen ini tidak pernah memegang indeks objek. Itu penting karena
 * daftar lokasi/paket adalah data yang scope-nya berbeda per pengguna —
 * mengirim indeks penuh ke klien untuk disaring di memori (cara kotak cari
 * lama di dashboard bekerja) berarti membocorkan nama objek yang tak boleh
 * dilihat, walaupun tidak pernah ditampilkan.
 *
 * Pengetikan tidak menembak query per huruf: ada jeda pendek supaya mengetik
 * "kedungmutih" jadi satu permintaan, bukan sebelas.
 */

/** Jeda sebelum query ditembak, ms. */
const JEDA_KETIK = 220;

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  /**
   * Hasil DISIMPAN BERSAMA kueri yang menghasilkannya.
   *
   * Tanpa itu, hasil lama bertahan di panel setelah kotak dikosongkan lalu
   * diketik ulang — selama jeda 220ms pengguna melihat daftar yang cocok
   * dengan kata SEBELUMNYA, dan menekan Enter saat itu membuka objek yang
   * salah. Menandai hasil dengan kuerinya membuat "sudah usang" bisa
   * dijawab tanpa menghapus state dari dalam effect.
   */
  const [hasil, setHasil] = useState<{ q: string; items: HasilCari[] }>({ q: "", items: [] });
  const [buka, setBuka] = useState(false);
  const [sorot, setSorot] = useState(0);
  const [menunggu, mulai] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const wadahRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // ⌘K / Ctrl+K dari mana pun. Dipasang di dokumen, bukan di input — gunanya
  // justru saat fokus sedang di tempat lain.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Klik di luar menutup panel. Pakai pointerdown supaya panel sudah tertutup
  // sebelum klik mendarat di elemen tujuan.
  useEffect(() => {
    if (!buka) return;
    function onPointer(e: PointerEvent) {
      if (!wadahRef.current?.contains(e.target as Node)) setBuka(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [buka]);

  useEffect(() => {
    const teks = q.trim();
    if (teks.length < MIN_HURUF_CARI) return;
    const t = setTimeout(() => {
      mulai(async () => {
        setHasil({ q: teks, items: await cariGlobal(teks) });
        setSorot(0);
      });
    }, JEDA_KETIK);
    return () => clearTimeout(t);
  }, [q]);

  function buka_(h: HasilCari) {
    setBuka(false);
    setQ("");
    router.push(h.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setBuka(false);
      inputRef.current?.blur();
      return;
    }
    if (!buka || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSorot((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSorot((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pilih = items[sorot];
      if (pilih) buka_(pilih);
    }
  }

  const teks = q.trim();
  const teksCukup = teks.length >= MIN_HURUF_CARI;
  // Hanya tampilkan hasil yang memang milik kueri saat ini.
  const segar = hasil.q === teks;
  const items = segar ? hasil.items : [];
  const tampilPanel = buka && teksCukup;
  const kosong = tampilPanel && segar && !menunggu && items.length === 0;

  return (
    <div ref={wadahRef} className="relative">
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 py-1.5 focus-within:border-primary-400">
        {menunggu ? (
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-ink-faint" />
        ) : (
          <Search aria-hidden className="size-4 shrink-0 text-ink-faint" />
        )}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setBuka(true);
          }}
          onFocus={() => setBuka(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={tampilPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Pencarian global"
          placeholder="Cari…"
          /* Sempit di ponsel dengan sengaja: topbar 375px harus memuat wordmark,
             breadcrumb, kotak ini, lonceng dan tombol keluar sekaligus. Melebar
             sedikit saja membuat seluruh halaman bisa digeser mendatar — persis
             yang dijaga tests/e2e/mobile-overflow.spec.ts.

             text-base di ponsel mencegah Safari iOS memperbesar halaman saat
             input difokus (DECISIONS 246) — utility SELALU menang atas base. */
          className="w-24 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none sm:w-52 sm:text-[13px]"
        />
        <kbd className="hidden shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint lg:inline">
          ⌘K
        </kbd>
      </div>

      {tampilPanel ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Hasil pencarian"
          className="shadow-popover absolute right-0 z-50 mt-1.5 max-h-96 w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-border bg-surface p-1"
        >
          {kosong ? (
            <p className="px-3 py-4 text-[12.5px] text-ink-muted">
              Tidak ada yang cocok dengan “{teks}”.
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-4 text-[12.5px] text-ink-muted">Mencari…</p>
          ) : (
            items.map((h, i) => (
              <button
                key={h.key}
                type="button"
                role="option"
                aria-selected={i === sorot}
                onPointerDown={(e) => {
                  e.preventDefault();
                  buka_(h);
                }}
                onMouseEnter={() => setSorot(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  i === sorot ? "bg-surface-muted" : "bg-transparent",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">
                    {h.judul}
                  </span>
                  {h.detail ? (
                    <span className="block truncate text-[11.5px] text-ink-muted">{h.detail}</span>
                  ) : null}
                </span>
                <span className="shrink-0 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                  {LABEL_JENIS_HASIL[h.jenis]}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
