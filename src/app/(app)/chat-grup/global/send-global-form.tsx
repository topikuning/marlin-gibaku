"use client";

import { useAksi } from "@/lib/aksi-klien";


import { Banner, Button, Combobox } from "@/components/ui";
import { sendGlobalSummaryAction, type ChatSummaryState } from "@/lib/waha/summary-actions";

/** Kirim ringkasan seluruh grup pada satu tanggal ke satu kontak WhatsApp. */
export function SendGlobalForm({
  dateKey,
  contacts,
}: {
  dateKey: string;
  contacts: { id: string; name: string }[];
}) {
  const [state, action, pending] = useAksi<ChatSummaryState>(sendGlobalSummaryAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="dateKey" value={dateKey} />
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="global-contact" className="text-sm text-ink-muted">
          Tujuan
        </label>
        <Combobox
          id="global-contact"
          name="contactId"
          defaultValue={contacts[0]?.id ?? ""}
          className="w-56"
          disabled={contacts.length === 0}
        >
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Combobox>
        <Button type="submit" size="sm" disabled={pending || contacts.length === 0}>
          {pending ? "Mengirim…" : "Kirim ke WhatsApp"}
        </Button>
        {contacts.length === 0 ? (
          <span className="text-xs text-ink-muted">Tambah kontak di Master Data → Kontak WA.</span>
        ) : null}
      </div>
    </form>
  );
}
