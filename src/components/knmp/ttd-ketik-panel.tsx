"use client";

import { useFormStatus } from "react-dom";
import { PenLine } from "lucide-react";
import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button } from "@/components/ui";
import { setTtdKetikLokasi, type PelaksanaActionState } from "@/lib/laporan/pelaksana-actions";

/**
 * NYALA/MATI TANDA TANGAN KETIK SATU LOKASI (DECISIONS 766).
 *
 * Permintaan user 2026-11-14: *"untuk fitur tanda tangan yang auto terisi, perlu
 * toggle on/off dengan default off. yang kontrolnya ada di lokasi"*, dan
 * *"pastikan laporan harian juga tekontrol dengan toggle on off ini"*.
 *
 * Satu sakelar untuk SEMUA dokumen lokasi ini – laporan harian, mingguan,
 * bulanan, Kurva S, rencana – di halaman cetak, PDF, dan Excel. Bentuknya
 * mengikuti sakelar lain di MARLIN (kotak berwarna + NYALA/MATI + satu tombol),
 * supaya keadaannya terbaca tanpa menekan apa pun.
 */
export function TtdKetikPanel({ locationId, aktif }: { locationId: string; aktif: boolean }) {
  const [state, aksi] = useAksi<PelaksanaActionState>(setTtdKetikLokasi, undefined);

  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      <div
        className={
          aktif
            ? "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-success-border bg-success-soft px-4 py-3"
            : "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3"
        }
      >
        <div className="flex min-w-0 flex-1 basis-56 items-start gap-2.5">
          <PenLine aria-hidden className={aktif ? "mt-0.5 size-4 shrink-0 text-success" : "mt-0.5 size-4 shrink-0 text-ink-muted"} />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink">Tanda tangan otomatis: {aktif ? "NYALA" : "MATI"}</p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {aktif
                ? "Penanda tangan yang namanya ada tetapi tanda tangannya belum diunggah tercetak dengan tanda tangan ketik dari namanya. Berlaku di semua dokumen lokasi ini, termasuk laporan harian."
                : "Bagian tanda tangan yang gambarnya belum diunggah tercetak kosong, untuk ditandatangani dengan pena. Nyalakan bila ingin diisi tanda tangan ketik dari nama orangnya."}
            </p>
          </div>
        </div>
        <form action={aksi} className="shrink-0">
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="aktif" value={aktif ? "0" : "1"} />
          <TombolSakelar aktif={aktif} />
        </form>
      </div>
    </div>
  );
}

function TombolSakelar({ aktif }: { aktif: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" loading={pending}>
      {aktif ? "Matikan" : "Nyalakan"}
    </Button>
  );
}
