"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui";
import { saringGrupWa } from "@/lib/waha/cari-grup";
import type { GrupDaftar } from "@/lib/waha/actions";

/**
 * Daftar grup WhatsApp yang BISA DICARI – dipakai form grup paket dan form
 * grup kabupaten (DECISIONS 747).
 *
 * Keluhan user 2026-11-06: *"muat data group ini juga menyusahkan pencarian,
 * jika jumlah group sudah banyak."* Dulu daftarnya hanya bisa digulung.
 * Sekarang ada kotak cari (per kata, urutan bebas, termasuk potongan ID), dan
 * grup yang sudah dipakai paket/kabupaten mana pun ditandai, supaya orang
 * tidak baru tahu sesudah menekan Simpan.
 */
export function PemilihGrupWa({
  groups,
  terpilih,
  onPilih,
  kataAwal = "",
  idCari,
}: {
  groups: GrupDaftar[];
  terpilih: string;
  onPilih: (g: GrupDaftar) => void;
  /** Isian awal kotak cari, mis. nama kabupaten. */
  kataAwal?: string;
  idCari: string;
}) {
  const [kata, setKata] = useState(kataAwal);
  const hasil = useMemo(() => saringGrupWa(groups, kata), [groups, kata]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <Input
          id={idCari}
          value={kata}
          onChange={(e) => setKata(e.target.value)}
          placeholder="Cari nama grup, kabupaten, atau potongan ID…"
          aria-label="Cari grup WhatsApp"
          className="pl-8"
        />
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-muted">
        <span className="tabular">
          {kata.trim() ? `${hasil.length} dari ${groups.length} grup cocok` : `${groups.length} grup`}
        </span>
        {kata.trim() ? (
          <button
            type="button"
            onClick={() => setKata("")}
            className="text-primary-600 underline-offset-2 hover:underline"
          >
            Tampilkan semua
          </button>
        ) : null}
      </p>
      {hasil.length === 0 ? (
        <p className="rounded-md border border-border p-2 text-[13px] text-ink-muted">
          Tidak ada grup yang cocok dengan &ldquo;{kata.trim()}&rdquo;. Coba kata lain, atau tempel link
          undangan / ID grupnya.
        </p>
      ) : (
        <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5">
          {hasil.map((g) => (
            <label
              key={g.id}
              className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-muted"
            >
              <input
                type="radio"
                name={`${idCari}-pilih`}
                checked={terpilih === g.id}
                onChange={() => onPilih(g)}
                className="mt-1 border-border"
              />
              <span className="min-w-0 break-words">
                {g.name}
                <span className="block text-xs text-ink-faint">
                  {g.id}
                  {g.tertaut ? <span className="text-warning"> · sudah tertaut</span> : null}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
