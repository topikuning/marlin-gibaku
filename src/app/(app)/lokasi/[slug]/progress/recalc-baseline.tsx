"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { recalcBaselineAction, type RabActionState } from "../rab/actions";

/** Tombol "Hitung ulang kurva-S" — regenerate baseline dari RAB aktif (versi baru). */
export function RecalcBaselineButton({ locationId }: { locationId: string }) {
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    recalcBaselineAction,
    undefined,
  );
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="locationId" value={locationId} />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        <RefreshCw aria-hidden className="size-3.5" />
        Hitung ulang
      </Button>
      {state?.error ? <Banner tone="error" title={state.error} className="mt-1" /> : null}
      {state?.success ? <Banner tone="success" title={state.success} className="mt-1" /> : null}
    </form>
  );
}
