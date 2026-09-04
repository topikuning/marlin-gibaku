"use client";

import { useAksi } from "@/lib/aksi-klien";


import { useFormStatus } from "react-dom";
import { CalendarCheck, CalendarOff } from "lucide-react";
import { Banner, Button, ConfirmSubmit } from "@/components/ui";
import { setMingguanAktifAction, type MingguanState } from "@/lib/mingguan/actions";

/**
 * SAKELAR laporan progres mingguan otomatis ke grup WhatsApp (DECISIONS 311).
 *
 * Berdiri sendiri, bukan menumpang sakelar pengingat harian: keduanya menumpang
 * putaran cron yang sama tetapi menagih hal berbeda ke orang berbeda —
 * pengingat harian mengejar Site Manager yang belum mengisi, laporan mingguan
 * melapor ke grup berisi PPK dan konsultan. Mematikan tagihan internal karena
 * libur bersama tidak boleh diam-diam ikut menghentikan laporan resmi ke
 * pemberi kerja.
 */
export function MingguanPanel({ aktif }: { aktif: boolean }) {
  const [state, aksi] = useAksi<MingguanState>(
    setMingguanAktifAction,
    undefined,
  );

  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      <div
        className={
          aktif
            ? "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-success-border bg-success-soft px-4 py-3"
            : "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-warning-border bg-warning-soft px-4 py-3"
        }
      >
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {aktif ? (
            <CalendarCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <CalendarOff aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          )}
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink">
              Laporan mingguan otomatis ke grup WA: {aktif ? "NYALA" : "MATI"}
            </p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {aktif
                ? "Tiap paket berjalan dikirimi pada HARI TERAKHIR minggu kontraknya sendiri, mengikuti MODE PERIODE MINGGU di kontraknya: mode Senin–Minggu (bawaan) berarti tiap hari Minggu, mode 7-hari berarti tujuh hari sejak SPMK sehingga harinya berbeda antar paket. Satu minggu hanya diumumkan sekali."
                : "Penjadwal tidak mengirim apa pun. Tombol “Kirim ke grup sekarang” di halaman paket TETAP bekerja."}
            </p>
          </div>
        </div>
        <form action={aksi} className="shrink-0">
          <input type="hidden" name="aktif" value={aktif ? "0" : "1"} />
          <TombolSakelar aktif={aktif} />
        </form>
      </div>
    </div>
  );
}

function TombolSakelar({ aktif }: { aktif: boolean }) {
  const { pending } = useFormStatus();
  // MENYALAKAN yang dikonfirmasi di sini, bukan mematikan — kebalikan dari
  // sakelar pengingat harian, dan itu disengaja. Yang berisiko pada laporan
  // mingguan adalah pesan resmi mulai berangkat ke grup pemberi kerja tanpa
  // ada yang merasa memutuskannya; mematikannya cuma membuat MARLIN diam.
  if (!aktif) {
    return (
      <ConfirmSubmit
        label="Nyalakan"
        title="Nyalakan laporan mingguan otomatis?"
        description="Mulai putaran cron berikutnya, MARLIN mengirim sendiri Laporan Progres Mingguan ke grup WhatsApp tiap paket berjalan, pada hari terakhir minggu kontraknya. Pesan WhatsApp tidak bisa ditarik kembali."
        confirmLabel="Ya, nyalakan"
        loading={pending}
      />
    );
  }
  return (
    <Button type="submit" variant="secondary" size="sm" loading={pending}>
      Matikan
    </Button>
  );
}
