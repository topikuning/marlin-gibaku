"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { generateChatSummaryAction, type ChatSummaryState } from "@/lib/waha/summary-actions";

/** Tombol buat/perbarui ringkasan AI satu hari (upsert per paket+tanggal). */
export function SummaryButton({
  packageId,
  dateKey,
  hasSummary,
  disabled,
}: {
  packageId: string;
  dateKey: string;
  hasSummary: boolean;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<ChatSummaryState, FormData>(
    generateChatSummaryAction,
    undefined,
  );
  return (
    <form action={action} className="text-right">
      <input type="hidden" name="packageId" value={packageId} />
      <input type="hidden" name="dateKey" value={dateKey} />
      <Button type="submit" size="sm" variant={hasSummary ? "secondary" : "primary"} disabled={disabled || pending}>
        {pending ? "Meringkas…" : hasSummary ? "Perbarui ringkasan" : "Ringkas dengan AI"}
      </Button>
      {state?.error ? <p className="mt-1 text-xs text-danger">{state.error}</p> : null}
    </form>
  );
}
