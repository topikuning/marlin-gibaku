"use client";

import Link from "next/link";
import { Printer, Sheet } from "lucide-react";
import { useState } from "react";
import { Button, FieldError, Label, Select } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Filter laporan periodik KKP. Alur (audit UX #7): user pilih Jenis → periode →
 * klik "Tampilkan" (set show=1) baru laporan digenerate; default belum tampil.
 * Input periode WAJIB (audit UX #6) — highlight merah bila kosong/di luar rentang,
 * bukan bubble bawaan browser. Tombol Cetak/Unduh dinonaktifkan sebelum digenerate.
 */

const LINK_BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-sm font-medium text-ink " +
  "transition-colors hover:bg-surface-muted hover:border-border-strong active:bg-surface-inset";
const LINK_BTN_DISABLED = "pointer-events-none opacity-50";

export function PeriodFilter({
  slug,
  kind,
  n,
  maxN,
  shown,
}: {
  slug: string;
  kind: "mingguan" | "bulanan";
  n: number;
  maxN: number;
  /** true bila laporan sedang ditampilkan (setelah Tampilkan). */
  shown: boolean;
}) {
  const [nErr, setNErr] = useState<string | null>(null);

  return (
    <form method="GET" className="flex flex-wrap items-end gap-3 text-sm">
      {/* show=1 menandai "generate eksplisit" */}
      <input type="hidden" name="show" value="1" />

      <div>
        <Label htmlFor="lp-kind">Jenis laporan</Label>
        <Select id="lp-kind" name="kind" defaultValue={kind} className="w-40">
          <option value="mingguan">Mingguan</option>
          <option value="bulanan">Bulanan</option>
        </Select>
      </div>

      <div>
        <Label htmlFor="lp-n" required>
          {kind === "mingguan" ? `Minggu ke (1–${maxN})` : `Bulan ke (1–${maxN})`}
        </Label>
        <input
          id="lp-n"
          type="number"
          name="n"
          min={1}
          max={maxN}
          defaultValue={n}
          required
          aria-invalid={nErr ? true : undefined}
          aria-describedby={nErr ? "lp-n-err" : undefined}
          onInvalid={(e) => {
            e.preventDefault();
            const el = e.currentTarget;
            setNErr(
              el.validity.valueMissing
                ? "Periode wajib diisi."
                : `Isi antara 1 dan ${maxN}.`,
            );
          }}
          onInput={() => nErr && setNErr(null)}
          className={cn(
            "tabular h-9 w-28 rounded-md border bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary-600",
            nErr ? "border-danger" : "border-border",
          )}
        />
        <FieldError id="lp-n-err">{nErr}</FieldError>
      </div>

      <Button type="submit">Tampilkan</Button>

      <span className="grow" />

      {/* Cetak & Unduh — aktif hanya setelah laporan digenerate */}
      <Link
        href={`/cetak/periodik/${slug}/${kind}/${n}`}
        aria-disabled={!shown}
        tabIndex={shown ? undefined : -1}
        className={cn(LINK_BTN, !shown && LINK_BTN_DISABLED)}
      >
        <Printer aria-hidden className="size-4" /> Cetak
      </Link>
      <a
        href={`/lokasi/${slug}/laporan-lokasi/export?kind=${kind}&n=${n}`}
        aria-disabled={!shown}
        tabIndex={shown ? undefined : -1}
        className={cn(LINK_BTN, !shown && LINK_BTN_DISABLED)}
      >
        <Sheet aria-hidden className="size-4" /> Unduh Excel
      </a>
    </form>
  );
}
