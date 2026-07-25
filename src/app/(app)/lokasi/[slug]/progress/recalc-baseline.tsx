"use client";

import { useActionState, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { recalcBaselineAction, type RabActionState } from "../rab/actions";

/**
 * Tombol "Hitung ulang kurva-S" — regenerate baseline dari RAB aktif.
 * Dua langkah (klik → konfirmasi) supaya tidak jalan karena salah klik.
 * Server idempotent: hasil identik → tidak dibuat versi baru.
 *
 * Tata letak "anti tumpang tindih": tombol selalu tetap di slot header; panel
 * konfirmasi + banner hasil (sukses/gagal) muncul sebagai popover `absolute`
 * (mengambang, z-30) di bawah-kanan tombol — TIDAK menambah tinggi/lebar header
 * sehingga tak pernah menekan judul kartu atau meluber ke kartu tetangga
 * ("Rencana vs realisasi").
 */
export function RecalcBaselineButton({ locationId }: { locationId: string }) {
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    recalcBaselineAction,
    undefined,
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
        <RefreshCw aria-hidden className="size-3.5" />
        Hitung ulang
      </Button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface p-3 text-left shadow-lg">
          {state?.error ? <Banner tone="error" title={state.error} className="mb-2" /> : null}
          {state?.success ? <Banner tone="success" title={state.success} className="mb-2" /> : null}
          <p className="mb-2 text-[13px] text-ink">
            Hitung ulang kurva-S dari RAB &amp; durasi kontrak saat ini? Bila hasilnya
            berbeda, baseline aktif digantikan versi baru (versi lama tetap tersimpan
            di Riwayat baseline). Edit manual pada baseline aktif akan ditimpa.
          </p>
          <form action={action} className="flex justify-end gap-2">
            <input type="hidden" name="locationId" value={locationId} />
            <Button type="submit" size="sm" variant="secondary" loading={pending}>
              Ya, hitung ulang
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Tutup
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
