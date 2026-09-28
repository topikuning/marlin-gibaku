"use client";

import { useState } from "react";
import { Banner, Button, Combobox, Label } from "@/components/ui";
import type { KolomManual, PilihanBaca } from "@/lib/rab/hps-parser";

/**
 * SHEET & KOLOM YANG DIBACA – ditanyakan, bukan ditebak diam-diam
 * (DECISIONS 624).
 *
 * Teguran user 2026-09-27: *"kenapa kamu tidak lempar pertanyaan ke user?
 * sheet mana yang dipakai ambil dari kolom mana, begitu kan lebih jelas.
 * daripada error gak jelas!"*.
 *
 * Dua keadaan:
 * - **Bertanya** (`sebab` terisi): MARLIN tidak bisa memastikan pembacaannya.
 *   Pilihan langsung terbuka, lengkap dengan sebabnya.
 * - **Pratinjau berhasil**: satu baris ringkas "sheet … · kolom …" dengan
 *   tombol untuk menggantinya – deteksi otomatis tetap bisa dikoreksi.
 *
 * Kolom yang disembunyikan di Excel tidak pernah ditawarkan (DECISIONS 604).
 */
export function PilihBaca({
  pilihan,
  sebab,
  manual,
  pending,
  onBaca,
}: {
  pilihan: PilihanBaca;
  /** Terisi = mode bertanya. */
  sebab?: string;
  /** Kolom sedang dipilih tangan (bukan deteksi otomatis). */
  manual: boolean;
  pending: boolean;
  /** kolom null = biarkan MARLIN mendeteksi kolom di sheet itu. */
  onBaca: (sheet: string, kolom: KolomManual | null) => void;
}) {
  const [buka, setBuka] = useState(Boolean(sebab));
  const [vol, setVol] = useState(String(pilihan.usulan?.vol ?? ""));
  const [unit, setUnit] = useState(String(pilihan.usulan?.unit ?? ""));
  const [price, setPrice] = useState(String(pilihan.usulan?.price ?? ""));
  const [amount, setAmount] = useState(String(pilihan.usulan?.amount ?? ""));

  const huruf = new Map(pilihan.kolom.map((k) => [String(k.kolom), k]));
  const opsiKolom = pilihan.kolom.map((k) => ({
    value: String(k.kolom),
    label:
      `${k.huruf} – ${k.label || "(tanpa judul)"}` + (k.contoh.length > 0 ? ` (${k.contoh.join("; ")})` : ""),
  }));
  const sebut = (v: string) => {
    const k = huruf.get(v);
    return k ? `${k.huruf}${k.label ? ` (${k.label})` : ""}` : "–";
  };
  const lengkap = vol && unit && amount && price;

  const ringkas = pilihan.usulan
    ? `volume ${sebut(String(pilihan.usulan.vol))} · satuan ${sebut(String(pilihan.usulan.unit))} · ` +
      `harga satuan ${sebut(String(pilihan.usulan.price))} · ` +
      `jumlah ${sebut(String(pilihan.usulan.amount))}`
    : null;

  return (
    <div
      className={`space-y-3 rounded-md border p-3 text-[13px] ${
        sebab ? "border-warning-border bg-warning-soft" : "border-border bg-surface"
      }`}
    >
      {sebab ? (
        <Banner
          tone="warning"
          title="MARLIN belum yakin membaca berkas ini – pilih sheet dan kolom yang dipakai"
          description={sebab}
        />
      ) : (
        <p className="text-ink-muted">
          Dibaca dari sheet <span className="font-semibold text-ink">{pilihan.sheet}</span>
          {manual ? " dengan kolom pilihan Anda" : ""}
          {ringkas ? (
            <>
              : <span className="text-ink">{ringkas}</span>
            </>
          ) : null}
          .
        </p>
      )}

      {buka ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="baca-sheet">Sheet yang dibaca</Label>
            <Combobox
              id="baca-sheet"
              value={pilihan.sheet}
              options={pilihan.sheets.map((n) => ({ value: n, label: n }))}
              disabled={pending}
              onChange={(n) => {
                // Sheet lain = kolomnya lain: kolom dideteksi ulang di sheet itu.
                if (n && n !== pilihan.sheet) onBaca(n, null);
              }}
            />
            <p className="mt-1 text-ink-muted">
              Hanya sheet yang terlihat. Sheet yang disembunyikan di Excel tidak dibaca.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="baca-vol" required>Volume</Label>
              <Combobox id="baca-vol" value={vol} onChange={setVol} options={opsiKolom} disabled={pending} placeholder="Pilih kolom…" />
            </div>
            <div>
              <Label htmlFor="baca-sat" required>Satuan</Label>
              <Combobox id="baca-sat" value={unit} onChange={setUnit} options={opsiKolom} disabled={pending} placeholder="Pilih kolom…" />
            </div>
            <div>
              <Label htmlFor="baca-harga" required>Harga satuan</Label>
              <Combobox
                id="baca-harga"
                value={price}
                onChange={setPrice}
                options={opsiKolom}
                disabled={pending}
                placeholder="Pilih kolom…"
              />
            </div>
            <div>
              <Label htmlFor="baca-jumlah" required>Jumlah harga</Label>
              <Combobox id="baca-jumlah" value={amount} onChange={setAmount} options={opsiKolom} disabled={pending} placeholder="Pilih kolom…" />
            </div>
          </div>
          <p className="text-ink-muted">
            Kolom yang disembunyikan di Excel tidak ditawarkan – kalau kolom yang benar tersembunyi,
            tampilkan dulu di Excel lalu pilih ulang berkasnya. Contoh isi tiap kolom ada di dalam kurung.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              loading={pending}
              disabled={!lengkap}
              onClick={() =>
                onBaca(pilihan.sheet, {
                  vol: Number(vol),
                  unit: Number(unit),
                  price: Number(price),
                  amount: Number(amount),
                })
              }
            >
              Pratinjau dengan kolom ini
            </Button>
            {manual ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => onBaca(pilihan.sheet, null)}>
                Kembali ke deteksi otomatis
              </Button>
            ) : null}
            {!sebab ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setBuka(false)}>
                Tutup
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setBuka(true)}>
          Ganti sheet atau kolom
        </Button>
      )}
    </div>
  );
}
