"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import {
  generateChatSummaryAction,
  sendChatSummaryAction,
  type ChatSummaryState,
} from "@/lib/waha/summary-actions";

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

/** Kirim ringkasan tersimpan ke satu kontak WhatsApp (Master Data → Kontak WA). */
export function SendSummaryForm({
  packageId,
  dateKey,
  contacts,
}: {
  packageId: string;
  dateKey: string;
  contacts: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ChatSummaryState, FormData>(sendChatSummaryAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 border-t border-border-muted pt-3">
      <input type="hidden" name="packageId" value={packageId} />
      <input type="hidden" name="dateKey" value={dateKey} />
      <label htmlFor={`kirim-${packageId}`} className="text-xs text-ink-muted">
        Kirim ke WhatsApp:
      </label>
      <select
        id={`kirim-${packageId}`}
        name="contactId"
        className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
        disabled={contacts.length === 0}
      >
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="secondary" disabled={pending || contacts.length === 0}>
        {pending ? "Mengirim…" : "Kirim"}
      </Button>
      {contacts.length === 0 ? (
        <span className="text-xs text-ink-muted">Tambah kontak di Master Data → Kontak WA.</span>
      ) : null}
      {state?.error ? <span className="text-xs text-danger">{state.error}</span> : null}
      {state?.success ? <span className="text-xs text-success">{state.success}</span> : null}
    </form>
  );
}
