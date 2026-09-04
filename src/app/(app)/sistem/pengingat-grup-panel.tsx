"use client";

import { useAksi } from "@/lib/aksi-klien";


import { useFormStatus } from "react-dom";
import { Users, UserX } from "lucide-react";
import { Banner, Button, ConfirmSubmit } from "@/components/ui";
import { setPengingatGrupAktifAction, type PengingatState } from "@/lib/harian/actions";

/**
 * SAKELAR pengingat laporan harian ke GRUP WhatsApp paket (ketetapan user
 * 2026-08-29, menindaklanjuti pengumuman KKP).
 *
 * Berdiri sendiri, bukan menumpang sakelar pengingat perorangan: yang membaca
 * pesan ini PPK dan konsultan pengawas. Mematikan tagihan internal saat libur
 * bersama tidak boleh diam-diam ikut membungkam yang satunya.
 */
export function PengingatGrupPanel({ aktif }: { aktif: boolean }) {
  const [state, aksi] = useAksi<PengingatState>(
    setPengingatGrupAktifAction,
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
            <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <UserX aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          )}
          <div className="min-w-0 text-sm">
            <p className="font-medium text-ink">
              Pengingat harian ke grup WA paket: {aktif ? "NYALA" : "MATI"}
            </p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {aktif
                ? "Tiap sore, paket yang laporan harian lokasinya belum lengkap ditagih di grupnya sendiri – berjeda satu menit antar grup supaya nomornya tidak ditandai spam. Grup yang keburu lengkap saat gilirannya tiba dilewati tanpa pesan."
                : "Penjadwal tidak mengirim apa pun ke grup. Pengingat perorangan ke HP penanggung jawab TETAP berjalan lewat sakelar di atas."}
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
  // Yang dikonfirmasi MENYALAKAN, sama seperti laporan mingguan: yang berisiko
  // adalah pesan mulai berangkat ke grup pemberi kerja tanpa ada yang merasa
  // memutuskannya. Mematikannya cuma membuat MARLIN diam.
  if (!aktif) {
    return (
      <ConfirmSubmit
        label="Nyalakan"
        title="Nyalakan pengingat harian ke grup?"
        description="Mulai putaran sore berikutnya, MARLIN menagih sendiri di grup WhatsApp tiap paket yang laporan harian lokasinya belum lengkap. Pesan WhatsApp tidak bisa ditarik kembali."
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
