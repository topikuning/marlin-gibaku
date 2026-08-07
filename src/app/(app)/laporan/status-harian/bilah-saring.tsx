"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Card, Combobox, Label } from "@/components/ui";
import {
  adaFilterAktif,
  tautFilter,
  type FilterStatusHarian,
} from "@/lib/daily-report/status-harian-filter";

/**
 * BILAH SARING PAPAN STATUS HARIAN.
 *
 * Permintaan user 2026-08-06: *"dimana filter kalau aku ingin langsung ke
 * lokasi tertentu, aku ingin tahu mana yang belum upload ke drive, mana yang
 * sudah laporan wa."*
 *
 * Dua bentuk kendali, dan pemilihannya bukan selera:
 *
 * - **Lokasi → `Combobox`.** 83 lokasi tidak bisa dipilih dengan menggulung;
 *   pemilihnya harus bisa diketik-cari. Ini juga aturan repo (DECISIONS
 *   094/115/174): tidak pernah `<select>` native.
 * - **Drive & WA → deretan tautan, bukan dropdown.** Pilihannya cuma 2–4 dan
 *   inilah pertanyaan yang paling sering ditanyakan ke papan ini. Sebagai
 *   tautan biasa ia satu ketukan, bekerja tanpa JavaScript, dan hasilnya punya
 *   ALAMAT sendiri — bisa dikirim ke orang lain lewat WA, yang justru cara
 *   kerja tim ini sehari-hari.
 *
 * Tanggal tetap `<form method="get">` supaya pemilih tanggal bawaan ponsel
 * dipakai apa adanya.
 *
 * ---
 *
 * Teguran user 2026-08-06 (sesudah bilah ini sempat kubuang demi grid):
 *
 *   *"Kamu di awal sudah benar, mauku kamu adaptasi, hanya tidak rapi, kusuruh
 *   jadi grid agar rapi, tapi kenapa malah berubah semua, gak berguna."*
 *
 * Betul, dan itu kesalahan penilaian yang mahal: yang diminta adalah TABELNYA
 * dirapikan jadi grid — bukan saringannya dihapus. Aku membuang isi yang sudah
 * benar demi bentuk yang baru. Bilah ini dikembalikan utuh; yang berubah hanya
 * susunannya (satu baris kendali, satu blok deret) dan tambahan deret
 * **Laporan** — jawaban atas *"filter laporan belum dan sudah/final saja kenapa
 * harus ketik2 manual"*: pertanyaannya tiga, jadi jawabannya tiga ketukan.
 */
export function BilahSaring({
  dateKey,
  filter,
  opsiLokasi,
  hariLabel,
  hariSebelum,
  hariSesudah,
}: {
  dateKey: string;
  filter: FilterStatusHarian;
  opsiLokasi: { value: string; label: string }[];
  hariLabel: string;
  /** Alamat siap pakai — BUKAN fungsi: fungsi tidak bisa menyeberang batas RSC. */
  hariSebelum: string;
  hariSesudah: string;
}) {
  const router = useRouter();

  return (
    <Card className="space-y-3 p-3">
      {/* Baris 1 — tanggal */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        {/* Filter lain ikut terbawa saat tanggal diganti: berpindah hari TIDAK
            boleh diam-diam mengosongkan saringan yang sedang dipakai. */}
        {filter.lokasi ? <input type="hidden" name="lokasi" value={filter.lokasi} /> : null}
        {filter.laporan !== "semua" ? (
          <input type="hidden" name="laporan" value={filter.laporan} />
        ) : null}
        {filter.drive !== "semua" ? <input type="hidden" name="drive" value={filter.drive} /> : null}
        {filter.wa !== "semua" ? <input type="hidden" name="wa" value={filter.wa} /> : null}

        <a
          href={hariSebelum}
          aria-label="Hari sebelumnya"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-surface-muted"
        >
          <ChevronLeft aria-hidden className="size-4" />
        </a>
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays aria-hidden className="size-4 shrink-0 text-ink-faint" />
          <input
            type="date"
            name="tanggal"
            defaultValue={dateKey}
            aria-label="Tanggal"
            className="h-8 min-w-0 rounded-md border border-border bg-surface px-2 text-[13px] text-ink"
          />
        </div>
        <a
          href={hariSesudah}
          aria-label="Hari berikutnya"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-surface-muted"
        >
          <ChevronRight aria-hidden className="size-4" />
        </a>
        <button
          type="submit"
          className="h-8 shrink-0 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:bg-surface-muted"
        >
          Tampilkan
        </button>
        <span className="text-[13px] text-ink-muted">{hariLabel}</span>
      </form>

      {/* Baris 2 — lokasi */}
      <div>
        <Label htmlFor="sh-lokasi">Lokasi</Label>
        <Combobox
          id="sh-lokasi"
          value={filter.lokasi}
          onChange={(v) => router.push(tautFilter(dateKey, filter, { lokasi: v }))}
          options={[{ value: "", label: "Semua lokasi" }, ...opsiLokasi]}
          placeholder="Cari lokasi…"
        />
      </div>

      {/* Baris 3 — Laporan, Drive & WA */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Deret
          judul="Laporan"
          pilihan={[
            { nilai: "semua", label: "Semua" },
            { nilai: "belum", label: "Belum lapor" },
            { nilai: "proses", label: "Belum final" },
            { nilai: "final", label: "Final" },
          ]}
          aktif={filter.laporan}
          taut={(v) => tautFilter(dateKey, filter, { laporan: v as FilterStatusHarian["laporan"] })}
        />
        <Deret
          judul="Google Drive"
          pilihan={[
            { nilai: "semua", label: "Semua" },
            { nilai: "belum", label: "Belum naik" },
            { nilai: "sudah", label: "Sudah naik" },
            { nilai: "gagal", label: "Gagal" },
          ]}
          aktif={filter.drive}
          taut={(v) => tautFilter(dateKey, filter, { drive: v as FilterStatusHarian["drive"] })}
        />
        <Deret
          judul="Laporan WhatsApp"
          pilihan={[
            { nilai: "semua", label: "Semua" },
            { nilai: "belum", label: "Belum dikirim" },
            { nilai: "sudah", label: "Sudah dikirim" },
          ]}
          aktif={filter.wa}
          taut={(v) => tautFilter(dateKey, filter, { wa: v as FilterStatusHarian["wa"] })}
        />
      </div>

      {adaFilterAktif(filter) ? (
        <a
          href={`/laporan/status-harian?tanggal=${dateKey}`}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-primary underline-offset-2 hover:underline"
        >
          <X aria-hidden className="size-3.5" />
          Bersihkan saringan
        </a>
      ) : null}
    </Card>
  );
}

function Deret({
  judul,
  pilihan,
  aktif,
  taut,
}: {
  judul: string;
  pilihan: { nilai: string; label: string }[];
  aktif: string;
  taut: (v: string) => string;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-muted">{judul}</p>
      <div className="flex flex-wrap gap-1.5">
        {pilihan.map((o) => {
          const dipilih = o.nilai === aktif;
          return (
            <a
              key={o.nilai}
              href={taut(o.nilai)}
              aria-current={dipilih ? "true" : undefined}
              className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
                dipilih
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-ink-muted hover:bg-surface-muted"
              }`}
            >
              {o.label}
            </a>
          );
        })}
      </div>
    </div>
  );
}
