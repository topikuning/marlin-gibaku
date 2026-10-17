"use client";

import { History, MapPin, Package, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Lapisan } from "@/components/ui/lapisan";
import { muatCariCepat } from "@/lib/cari-cepat/actions";
import type { DaftarCepat, EntriCepat } from "@/lib/cari-cepat/daftar";
import { catatKunjungan, hrefLokasiSerupa, kunciKunjungan, saringCari } from "@/lib/cari-cepat/murni";
import { cn } from "@/lib/cn";

/**
 * CARI CEPAT – ⌘K / Ctrl+K dari halaman mana pun (DECISIONS 684).
 *
 * Permintaan user 2026-10-17: pindah ke lokasi atau paket lain tanpa harus
 * kembali ke menu Lokasi, membuka paketnya, lalu mencari lagi.
 *
 * - Daftar dimuat saat jendela DIBUKA (dan saat tombolnya disentuh), bukan di
 *   tiap halaman; isinya disegarkan tiap kali dibuka.
 * - Lokasi dibuka di TAB YANG SAMA dengan halaman sekarang (RAB tetap RAB),
 *   aturan yang sama dengan pemilih lokasi di kepala halaman lokasi.
 * - Tanpa ketikan: "Terakhir dibuka", dicatat dari halaman lokasi/paket yang
 *   memang dikunjungi di peramban ini. Yang tampil hanya yang masih boleh
 *   dibuka – catatan peramban tidak pernah menjadi sumber akses.
 */
const KUNCI_SIMPAN = "marlin:cari-cepat:terakhir";
const BATAS = { lokasi: 8, paket: 5 } as const;

function bacaTerakhir(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KUNCI_SIMPAN) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const tanpaLangganan = () => () => {};

type Kelompok = { judul: string; entri: EntriCepat[]; lebih: number };

export function CariCepat() {
  const pathname = usePathname();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [kueri, setKueri] = useState("");
  const [aktif, setAktif] = useState(0);
  const [data, setData] = useState<DaftarCepat | null>(null);
  const [gagal, setGagal] = useState(false);
  const [terakhir, setTerakhir] = useState<string[]>([]);
  const memuat = useRef(false);
  const kembaliKe = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // `null` saat render server → tanda pintasan baru muncul sesudah hidrasi,
  // jadi tidak ada ketidakcocokan "⌘K" vs "Ctrl K".
  const mac = useSyncExternalStore(
    tanpaLangganan,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => null,
  );

  // Catat kunjungan halaman lokasi/paket – hanya menulis ke peramban.
  useEffect(() => {
    const k = kunciKunjungan(pathname);
    if (!k) return;
    try {
      localStorage.setItem(KUNCI_SIMPAN, JSON.stringify(catatKunjungan(bacaTerakhir(), k)));
    } catch {
      // Penyimpanan peramban ditutup (mode privat): daftar terakhir kosong saja.
    }
  }, [pathname]);

  const muat = useCallback(() => {
    if (memuat.current) return;
    memuat.current = true;
    muatCariCepat()
      .then((d) => {
        setData(d);
        setGagal(false);
      })
      .catch(() => setGagal(true))
      .finally(() => {
        memuat.current = false;
      });
  }, []);

  const buka = useCallback(() => {
    kembaliKe.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTerakhir(bacaTerakhir());
    setKueri("");
    setAktif(0);
    setOpen(true);
    muat();
  }, [muat]);

  const tutup = useCallback(() => {
    setOpen(false);
    kembaliKe.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (open) tutup();
      else buka();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, buka, tutup]);

  // Lewat ref-panggil, bukan efek `[open]`: Lapisan baru memasang portalnya
  // sesudah render pertama, jadi saat efek itu berjalan isiannya belum ada.
  const pasangInput = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
    el?.focus();
  }, []);

  const kelompok: Kelompok[] = useMemo(() => {
    if (!data) return [];
    if (!kueri.trim()) {
      const peta = new Map<string, EntriCepat>([
        ...data.lokasi.map((e) => [`l:${e.kunci}`, e] as const),
        ...data.paket.map((e) => [`p:${e.kunci}`, e] as const),
      ]);
      // Halaman yang sedang dibuka tidak perlu ditawarkan lagi.
      const kini = kunciKunjungan(pathname);
      const entri = terakhir
        .filter((k) => k !== kini)
        .map((k) => peta.get(k))
        .filter((e): e is EntriCepat => e != null);
      return entri.length ? [{ judul: "Terakhir dibuka", entri, lebih: 0 }] : [];
    }
    const l = saringCari(data.lokasi, kueri);
    const p = saringCari(data.paket, kueri);
    return [
      { judul: "Lokasi", entri: l.slice(0, BATAS.lokasi), lebih: Math.max(0, l.length - BATAS.lokasi) },
      { judul: "Paket", entri: p.slice(0, BATAS.paket), lebih: Math.max(0, p.length - BATAS.paket) },
    ].filter((g) => g.entri.length > 0);
  }, [data, kueri, terakhir, pathname]);

  const datar = kelompok.flatMap((g) => g.entri);
  const a = Math.min(aktif, Math.max(0, datar.length - 1));
  const idOpsi = (i: number) => `${listId}-${i}`;

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${a}`)?.scrollIntoView({ block: "nearest" });
  }, [open, a, listId]);

  const href = (e: EntriCepat) => (e.jenis === "lokasi" ? hrefLokasiSerupa(pathname, e.kunci) : `/paket/${e.kunci}`);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = datar.length;
    if (e.key === "ArrowDown" && n) {
      e.preventDefault();
      setAktif((a + 1) % n);
    } else if (e.key === "ArrowUp" && n) {
      e.preventDefault();
      setAktif((a - 1 + n) % n);
    } else if (e.key === "Enter" && n) {
      e.preventDefault();
      // Klik tautannya, bukan router.push: bilah kemajuan navigasi dan
      // penahan ketukan ganda (nav-progress) hanya membaca klik tautan.
      document.getElementById(idOpsi(a))?.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      tutup();
    } else if (e.key === "Tab") {
      // Satu-satunya isian di jendela ini; fokus jangan lari ke halaman di belakang.
      e.preventDefault();
    }
  }

  const q = kueri.trim();
  /** Nomor urut pertama tiap kelompok di daftar datar (untuk ↑ ↓). */
  const awal = kelompok.map((_, gi) => kelompok.slice(0, gi).reduce((s, g) => s + g.entri.length, 0));

  return (
    <>
      <button
        type="button"
        onClick={buka}
        onPointerEnter={() => data || muat()}
        onFocus={() => data || muat()}
        aria-label="Cari lokasi atau paket"
        aria-keyshortcuts="Control+K Meta+K"
        className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink md:w-64"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="hidden flex-1 text-left md:inline">Cari lokasi atau paket</span>
        {mac == null ? null : (
          <kbd className="hidden rounded border border-border bg-surface-muted px-1.5 font-sans text-[11px] text-ink-muted md:inline">
            {mac ? "⌘K" : "Ctrl K"}
          </kbd>
        )}
      </button>

      {open ? (
        <Lapisan className="flex items-start justify-center px-4 pt-[calc(4rem+env(safe-area-inset-top))]">
          <div aria-hidden className="absolute inset-0 bg-ink/40" onClick={tutup} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Cari lokasi atau paket"
            // Klik di dalam jendela tidak mencuri fokus dari isian.
            onMouseDown={(e) => {
              if (e.target !== inputRef.current) e.preventDefault();
            }}
            className="relative flex max-h-[min(36rem,calc(100dvh-6rem))] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search aria-hidden className="size-4 shrink-0 text-ink-muted" />
              <input
                ref={pasangInput}
                role="combobox"
                aria-expanded={datar.length > 0}
                aria-controls={listId}
                aria-activedescendant={datar.length ? idOpsi(a) : undefined}
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                value={kueri}
                onChange={(e) => {
                  setKueri(e.target.value);
                  setAktif(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Nama lokasi, desa, kabupaten, atau paket"
                className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
              />
              <button
                type="button"
                onClick={tutup}
                className="shrink-0 rounded px-1.5 py-1 text-[12px] text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                <span className="sm:hidden">Tutup</span>
                <kbd className="hidden font-sans sm:inline">Esc</kbd>
              </button>
            </div>

            <div id={listId} role="listbox" aria-label="Hasil pencarian" className="min-h-0 flex-1 overflow-y-auto py-1">
              {kelompok.map((g, gi) => (
                <div key={g.judul} role="group" aria-label={g.judul}>
                  <p className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
                    {g.judul === "Terakhir dibuka" ? <History aria-hidden className="size-3.5" /> : null}
                    {g.judul}
                  </p>
                  {g.entri.map((e, ei) => {
                    const i = awal[gi] + ei;
                    const Ikon = e.jenis === "lokasi" ? MapPin : Package;
                    return (
                      <Link
                        key={`${e.jenis}:${e.kunci}`}
                        id={idOpsi(i)}
                        href={href(e)}
                        role="option"
                        aria-selected={i === a}
                        onClick={tutup}
                        onMouseMove={() => i !== a && setAktif(i)}
                        className={cn(
                          "flex items-start gap-2.5 px-3 py-2 text-left",
                          i === a && "bg-surface-muted",
                        )}
                      >
                        <Ikon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium break-words text-ink">{e.judul}</span>
                          {e.keterangan ? (
                            <span className="block text-[12px] break-words text-ink-muted">{e.keterangan}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 pt-0.5 text-[11px] text-ink-muted">
                          {g.judul === "Terakhir dibuka" ? `${e.jenis === "lokasi" ? "Lokasi" : "Paket"} · ` : ""}
                          {e.status}
                        </span>
                      </Link>
                    );
                  })}
                  {g.lebih > 0 ? (
                    <p className="px-3 pt-1 pb-2 pl-9 text-[12px] text-ink-faint">
                      {g.lebih} {g.judul.toLowerCase()} lain juga cocok – ketik lebih lengkap untuk mempersempit.
                    </p>
                  ) : null}
                </div>
              ))}

              {!data ? (
                gagal ? (
                  <div className="px-3 py-4 text-sm text-ink-muted">
                    Daftar belum bisa dimuat. Periksa sambungan Anda, lalu{" "}
                    <button type="button" onClick={muat} className="font-medium text-primary-700 underline">
                      coba lagi
                    </button>
                    .
                  </div>
                ) : (
                  <p className="px-3 py-4 text-sm text-ink-muted">Memuat daftar lokasi dan paket…</p>
                )
              ) : datar.length === 0 ? (
                <p className="px-3 py-4 text-sm text-ink-muted">
                  {q
                    ? `Tidak ada lokasi atau paket yang cocok dengan “${q}”.`
                    : "Ketik nama lokasi, desa, kabupaten, nama paket, atau perusahaan."}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border bg-surface-muted px-3 py-2 text-[11px] text-ink-muted">
              <span>
                {data?.terbatas ? "Hanya lokasi yang ditugaskan ke Anda." : "Semua lokasi dan paket organisasi."}
              </span>
              <span className="hidden sm:inline">↑ ↓ memilih · Enter membuka · Esc menutup</span>
            </div>
          </div>
        </Lapisan>
      ) : null}
    </>
  );
}
