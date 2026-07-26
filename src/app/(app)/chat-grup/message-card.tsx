import { Badge } from "@/components/ui";
import { Paperclip } from "lucide-react";
import type { ChatMessageView } from "@/lib/waha/chat-summary";
import { CATEGORY_LABEL, RELEVANCE_LABEL, RELEVANCE_TONE } from "@/lib/waha/message-classify";
import { SenderAliasForm } from "./sender-alias-form";

/**
 * Satu kartu bukti percakapan. Bobot relevansi terlihat langsung — pesan
 * berkonteks rendah tampil redup supaya tidak "seberat" pesan kendala.
 */
export function MessageCard({ m, dim = false }: { m: ChatMessageView; dim?: boolean }) {
  const low = m.class.relevance === "konteks_rendah";
  return (
    <li
      className={`rounded-md border px-3 py-2 ${
        low || dim ? "border-dashed border-border-muted bg-surface-inset/40" : "border-border bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="tabular text-xs text-ink-faint">{m.timeLabel}</span>
        <span className="text-sm font-medium text-ink">{m.sender.displayName}</span>
        {m.fromMe ? <Badge tone="info" label="MARLIN" /> : null}
        <span className="ml-auto flex items-center gap-1">
          {!m.fromMe ? (
            <Badge tone={RELEVANCE_TONE[m.class.relevance]} label={RELEVANCE_LABEL[m.class.relevance]} />
          ) : null}
          {m.class.category !== "lainnya" ? (
            <Badge tone="neutral" label={CATEGORY_LABEL[m.class.category]} />
          ) : null}
        </span>
      </div>
      <p className={`mt-1 text-sm whitespace-pre-wrap ${low ? "text-ink-faint" : "text-ink-muted"}`}>
        {m.body || <span className="italic">(tanpa teks)</span>}
        {m.hasMedia ? (
          <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-ink-faint">
            <Paperclip aria-hidden className="size-3" />
            lampiran
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-[11px] text-ink-faint">{m.class.reason}</p>
      {m.sender.needsAlias && m.sender.senderKey ? (
        <SenderAliasForm senderKey={m.sender.senderKey} hint={m.sender.displayName} />
      ) : null}
    </li>
  );
}
