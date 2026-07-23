"use client";

import { useActionState, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { recalcBaselineAction, type RabActionState } from "../rab/actions";

/**
 * Tombol "Hitung ulang kurva-S" — regenerate baseline dari RAB aktif.
 * Dua langkah (klik → konfirmasi) supaya tidak jalan karena salah klik.
 * Server idempotent: hasil identik → tidak dibuat versi baru.
 */
export function RecalcBaselineButton({ locationId }: { locationId: string }) {
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    recalcBaselineAction,
    undefined,
  );
  const [confirm, setConfirm] = useState(false);

  if (!confirm) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" size="sm" variant="secondary" onClick={() => setConfirm(true)}>
          <RefreshCw aria-hidden className="size-3.5" />
          Hitung ulang
        </Button>
        {state?.error ? <Banner tone="error" title={state.error} className="mt-1" /> : null}
        {state?.success ? <Banner tone="success" title={state.success} className="mt-1" /> : null}
      </div>
    );
  }

  return (
    <div className="max-w-xs rounded-md border border-border bg-surface-muted p-3 text-right">
      <p className="mb-2 text-left text-[13px] text-ink">
        Hitung ulang kurva-S dari RAB & durasi kontrak saat ini? Bila hasilnya
        berbeda, baseline aktif digantikan versi baru (versi lama tetap tersimpan
        di Riwayat baseline). Edit manual pada baseline aktif akan ditimpa.
      </p>
      <form action={action} className="flex justify-end gap-2">
        <input type="hidden" name="locationId" value={locationId} />
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Ya, hitung ulang
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>
          Batal
        </Button>
      </form>
      {state?.error ? <Banner tone="error" title={state.error} className="mt-2 text-left" /> : null}
      {state?.success ? <Banner tone="success" title={state.success} className="mt-2 text-left" /> : null}
    </div>
  );
}
