"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * PEMILIH LOKASI — daftar panjang yang tetap bisa dipakai.
 *
 * Sebelumnya scope AI cuma kotak scroll berisi seluruh lokasi berurut abjad,
 * tanpa pencarian dan tanpa pilih-sekaligus. Pada 83 lokasi (arsitektur
 * menargetkan 200+) itu berarti menggulir mencari satu nama, dan memilih satu
 * paket berarti mencentang belasan baris satu per satu. Laporan user
 * 2026-08-03: *"bagaimana aku melakukan filter mana yang akan aku pilih, dengan
 * lokasi sebanyak itu akan sangat merepotkan"*. DECISIONS 240.
 *
 * Yang membuatnya bisa dipakai:
 * - **Pencarian** atas nama lokasi DAN nama paket — orang lapangan mengingat
 *   salah satu, bukan keduanya.
 * - **Dikelompokkan per paket**, dengan centang tingkat paket: satu ketukan
 *   untuk seluruh lokasi di dalamnya, bukan belasan.
 * - **Pilih semua / Kosongkan** untuk hasil yang SEDANG TAMPIL — jadi "cari
 *   lalu pilih semua hasilnya" jadi dua ketukan.
 * - **Ringkasan terpilih** berupa chip yang bisa dilepas satu-satu, supaya
 *   pilihan yang tergulir jauh tetap terlihat dan bisa dibatalkan.
 *
 * Jumlah yang disembunyikan filter SELALU disebut — daftar yang menyusut diam-
 * diam terbaca "lokasinya memang cuma segini".
 */

export type LokasiPilihan = {
  id: string;
  name: string;
  /** Nama paket; dipakai mengelompokkan dan ikut dicari. */
  packageName?: string | null;
};

const TANPA_PAKET = "Tanpa paket";

export function PemilihLokasi({
  locations,
  selected,
  onChange,
  /** Kalimat saat tidak ada yang dipilih — biasanya "kosong = seluruh lokasi". */
  petunjukKosong,
  maxTinggi = "max-h-72",
}: {
  locations: LokasiPilihan[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  petunjukKosong?: string;
  maxTinggi?: string;
}) {
  const [cari, setCari] = useState("");
  const [tertutup, setTertutup] = useState<Set<string>>(new Set());

  const kunci = cari.trim().toLowerCase();
  const cocok = useMemo(
    () =>
      kunci
        ? locations.filter(
            (l) =>
              l.name.toLowerCase().includes(kunci) ||
              (l.packageName ?? "").toLowerCase().includes(kunci),
          )
        : locations,
    [locations, kunci],
  );

  /** Kelompok per paket, urut nama paket lalu nama lokasi. */
  const kelompok = useMemo(() => {
    const m = new Map<string, LokasiPilihan[]>();
    for (const l of cocok) {
      const k = l.packageName?.trim() || TANPA_PAKET;
      const arr = m.get(k) ?? [];
      arr.push(l);
      m.set(k, arr);
    }
    return [...m.entries()]
      .map(([nama, isi]) => [nama, isi.sort((a, b) => a.name.localeCompare(b.name, "id"))] as const)
      .sort((a, b) => a[0].localeCompare(b[0], "id"));
  }, [cocok]);

  const ubah = (f: (s: Set<string>) => void) => {
    const next = new Set(selected);
    f(next);
    onChange(next);
  };
  const toggle = (id: string) => ubah((s) => (s.has(id) ? s.delete(id) : s.add(id)));
  const toggleKelompok = (isi: LokasiPilihan[]) => {
    const semua = isi.every((l) => selected.has(l.id));
    ubah((s) => isi.forEach((l) => (semua ? s.delete(l.id) : s.add(l.id))));
  };

  const terpilih = locations.filter((l) => selected.has(l.id));
  const disembunyikan = locations.length - cocok.length;

  return (
    <div className="space-y-2">
      {/* Pencarian + aksi massal */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari lokasi atau paket…"
            aria-label="Cari lokasi atau paket"
            className="h-9 w-full rounded-md border border-border bg-surface pr-2 pl-8 text-sm text-ink"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => ubah((s) => cocok.forEach((l) => s.add(l.id)))}
          disabled={cocok.length === 0}
        >
          <Check aria-hidden className="size-3.5" />
          {kunci ? `Pilih ${cocok.length} hasil` : "Pilih semua"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(new Set())} disabled={selected.size === 0}>
          Kosongkan
        </Button>
      </div>

      {/* Ringkasan terpilih — pilihan yang tergulir jauh tetap terlihat. */}
      {terpilih.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-surface-inset/60 p-2">
          <span className="text-xs font-medium text-ink-muted">{terpilih.length} lokasi dipilih:</span>
          {terpilih.slice(0, 12).map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => toggle(l.id)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-ink hover:bg-surface-muted"
              aria-label={`Batalkan ${l.name}`}
            >
              {l.name}
              <X aria-hidden className="size-3 text-ink-faint" />
            </button>
          ))}
          {terpilih.length > 12 ? (
            <span className="text-xs text-ink-muted">+{terpilih.length - 12} lainnya</span>
          ) : null}
        </div>
      ) : petunjukKosong ? (
        <p className="text-xs text-ink-muted">{petunjukKosong}</p>
      ) : null}

      {/* Daftar berkelompok */}
      <div className={cn("space-y-1 overflow-y-auto rounded-md border border-border p-2", maxTinggi)}>
        {kelompok.length === 0 ? (
          <p className="px-1 py-2 text-sm text-ink-muted">
            {locations.length === 0
              ? "Tidak ada lokasi dalam izin Anda."
              : `Tidak ada lokasi cocok "${cari}".`}
          </p>
        ) : (
          kelompok.map(([nama, isi]) => {
            const semua = isi.every((l) => selected.has(l.id));
            const sebagian = !semua && isi.some((l) => selected.has(l.id));
            const buka = !tertutup.has(nama);
            return (
              <div key={nama}>
                <div className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={semua}
                    ref={(el) => {
                      if (el) el.indeterminate = sebagian;
                    }}
                    onChange={() => toggleKelompok(isi)}
                    aria-label={`Pilih semua lokasi paket ${nama}`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setTertutup((prev) => {
                        const next = new Set(prev);
                        if (next.has(nama)) next.delete(nama);
                        else next.add(nama);
                        return next;
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                    aria-expanded={buka}
                  >
                    {buka ? (
                      <ChevronDown aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
                    ) : (
                      <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
                    )}
                    <span className="truncate text-[13px] font-medium text-ink">{nama}</span>
                    <span className="shrink-0 text-xs text-ink-faint">({isi.length})</span>
                  </button>
                </div>
                {buka
                  ? isi.map((l) => (
                      <label
                        key={l.id}
                        className="flex cursor-pointer items-center gap-2 rounded py-0.5 pl-7 text-sm hover:bg-surface-muted"
                      >
                        <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                        <span className="truncate">{l.name}</span>
                      </label>
                    ))
                  : null}
              </div>
            );
          })
        )}
      </div>

      {/* Yang disembunyikan filter DISEBUT jumlahnya. */}
      {disembunyikan > 0 ? (
        <p className="text-xs text-ink-faint">
          {cocok.length} dari {locations.length} lokasi tampil · {disembunyikan} disembunyikan pencarian.
        </p>
      ) : null}
    </div>
  );
}
