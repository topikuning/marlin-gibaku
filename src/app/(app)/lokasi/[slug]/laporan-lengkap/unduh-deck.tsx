"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Combobox, TautanUnduh } from "@/components/ui";
import { PILIHAN_TEMA_DECK, TEMA_DECK_DEFAULT } from "@/lib/paparan/tema";

/**
 * UNDUH DECK 16:9 LAPORAN LENGKAP LOKASI + pemilih temanya.
 *
 * Tema hanya mengubah RUPA deck – isi dan setiap angkanya datang dari snapshot
 * yang sama dengan layar dan PDF A4. Pilihannya ditaruh di sebelah tombolnya,
 * bukan di halaman pengaturan: yang memilih tema adalah orang yang sedang
 * menyiapkan bahan rapat, saat itu juga.
 */
export function UnduhDeckLaporanLengkap({ slug }: { slug: string }) {
  const [tema, setTema] = useState<string>(TEMA_DECK_DEFAULT);
  const deskripsi = PILIHAN_TEMA_DECK.find((t) => t.value === tema)?.deskripsi ?? "";

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-56">
        <label htmlFor="deck-tema" className="mb-1 block text-[12px] font-medium text-ink">
          Tema deck
        </label>
        <Combobox id="deck-tema" value={tema} onChange={setTema}>
          {PILIHAN_TEMA_DECK.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Combobox>
      </div>
      <TautanUnduh
        href={`/api/lokasi/${slug}/laporan-lengkap?bentuk=deck&tema=${tema}`}
        labelSibuk="Menyiapkan deck…"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-ink hover:border-border-strong hover:bg-surface-muted"
      >
        <FileText aria-hidden className="size-4" />
        Unduh deck 16:9
      </TautanUnduh>
      {deskripsi ? <p className="w-full text-xs text-ink-muted">{deskripsi}</p> : null}
    </div>
  );
}
