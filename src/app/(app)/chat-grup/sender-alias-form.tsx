"use client";

import { useActionState, useState } from "react";
import { Button, Input } from "@/components/ui";
import { saveSenderAliasAction, type ChatSummaryState } from "@/lib/waha/summary-actions";

/**
 * Beri nama pada pengirim chat yang belum dikenali (nomor/LID). Sekali dipetakan,
 * berlaku untuk semua ringkasan & arsip berikutnya. DECISIONS 138.
 */
export function SenderAliasForm({ senderKey, hint }: { senderKey: string; hint: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ChatSummaryState, FormData>(saveSenderAliasAction, undefined);

  if (state?.success) {
    return <span className="text-xs text-success">{state.success}</span>;
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-primary hover:underline"
      >
        Beri nama pengirim ini
      </button>
    );
  }
  return (
    <form action={action} className="mt-1 flex flex-wrap items-end gap-1.5">
      <input type="hidden" name="senderKey" value={senderKey} />
      <div>
        <label htmlFor={`nm-${senderKey}`} className="block text-[11px] text-ink-muted">
          Nama ({hint})
        </label>
        <Input id={`nm-${senderKey}`} name="displayName" placeholder="mis. Prio Yulianto" className="h-8 w-44 text-sm" />
      </div>
      <div>
        <label htmlFor={`rl-${senderKey}`} className="block text-[11px] text-ink-muted">
          Peran (opsional)
        </label>
        <Input id={`rl-${senderKey}`} name="role" placeholder="mis. Mandor" className="h-8 w-32 text-sm" />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Batal
      </Button>
      {state?.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
