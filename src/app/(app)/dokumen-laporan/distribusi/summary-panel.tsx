"use client";

import { useActionState, useState } from "react";
import { Badge, Button, Combobox, Textarea } from "@/components/ui";
import {
  generateChatSummaryAction,
  saveSummaryDraftAction,
  sendChatSummaryAction,
  type ChatSummaryState,
} from "@/lib/waha/summary-actions";
import {
  SUMMARY_STATUS_HINT,
  SUMMARY_STATUS_LABEL,
  SUMMARY_STATUS_TONE,
  canFinalize,
  canSend,
  confidenceLabel,
  confidenceTone,
  type SummaryViewStatus,
} from "@/lib/waha/summary-lifecycle";

export type TimelineItem = { label: string; at: string; by: string | null };

export type SummaryPanelProps = {
  packageId: string;
  dateKey: string;
  status: SummaryViewStatus;
  /** Teks tersimpan (hasil AI atau editan manusia). */
  summaryText: string;
  /** Draf AI asli — untuk membandingkan bila sudah disunting. */
  aiText: string | null;
  confidence: number | null;
  version: number;
  providerLabel: string | null;
  /** Alasan tombol "Hasilkan draf" mati; null = boleh jalan. */
  blockedReason: string | null;
  timeline: TimelineItem[];
  contacts: { id: string; name: string }[];
};

/**
 * Panel kanan: satu tempat untuk status, keyakinan, editor, jejak, dan aksi.
 * Editor TIDAK diletakkan jauh di bawah — reviewer membaca bukti di kolom
 * tengah dan menyunting di sini tanpa berpindah halaman. DECISIONS 139.
 */
export function SummaryPanel(props: SummaryPanelProps) {
  const {
    packageId,
    dateKey,
    status,
    summaryText,
    aiText,
    confidence,
    version,
    providerLabel,
    blockedReason,
    timeline,
    contacts,
  } = props;

  const [genState, genAction, genPending] = useActionState<ChatSummaryState, FormData>(
    generateChatSummaryAction,
    undefined,
  );
  const [editState, editAction, editPending] = useActionState<ChatSummaryState, FormData>(
    saveSummaryDraftAction,
    undefined,
  );
  const [sendState, sendAction, sendPending] = useActionState<ChatSummaryState, FormData>(
    sendChatSummaryAction,
    undefined,
  );
  const [text, setText] = useState(summaryText);
  const [showAi, setShowAi] = useState(false);

  const exists = status !== "belum_dibuat";
  const edited = aiText != null && aiText.trim() !== summaryText.trim();

  return (
    <div className="space-y-4">
      {/* Status + keyakinan */}
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SUMMARY_STATUS_TONE[status]} label={SUMMARY_STATUS_LABEL[status]} />
          {exists ? <span className="text-xs text-ink-faint">versi {version}</span> : null}
          {confidence != null ? (
            <span className="ml-auto text-xs text-ink-muted">
              Keyakinan{" "}
              <span
                className={
                  confidenceTone(confidence) === "success"
                    ? "font-semibold text-success"
                    : confidenceTone(confidence) === "warning"
                      ? "font-semibold text-warning"
                      : "font-semibold text-danger"
                }
              >
                {confidenceLabel(confidence)} ({confidence})
              </span>
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-ink-muted">{SUMMARY_STATUS_HINT[status]}</p>
        {confidence != null ? (
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-inset"
            role="img"
            aria-label={`Keyakinan ${confidence} dari 100`}
          >
            <div
              className={
                confidenceTone(confidence) === "success"
                  ? "h-full bg-success"
                  : confidenceTone(confidence) === "warning"
                    ? "h-full bg-warning"
                    : "h-full bg-danger"
              }
              style={{ width: `${confidence}%` }}
            />
          </div>
        ) : null}
        {providerLabel ? <p className="mt-2 text-[11px] text-ink-faint">{providerLabel}</p> : null}
      </div>

      {/* Hasilkan / perbarui draf */}
      <form action={genAction}>
        <input type="hidden" name="packageId" value={packageId} />
        <input type="hidden" name="dateKey" value={dateKey} />
        <Button
          type="submit"
          variant={exists ? "secondary" : "primary"}
          className="w-full"
          disabled={!!blockedReason || genPending}
          loading={genPending}
        >
          {genPending ? "Menyusun draf…" : exists ? "Susun ulang draf AI" : "Hasilkan draf AI"}
        </Button>
        {blockedReason ? <p className="mt-1 text-xs text-ink-muted">{blockedReason}</p> : null}
        {exists && !blockedReason ? (
          <p className="mt-1 text-xs text-ink-muted">
            Menyusun ulang menimpa teks saat ini dan mengembalikan status ke draf AI.
          </p>
        ) : null}
        {genState?.error ? <p className="mt-1 text-xs text-danger">{genState.error}</p> : null}
      </form>

      {/* Editor + finalisasi */}
      {exists ? (
        <form action={editAction} className="space-y-2">
          <input type="hidden" name="packageId" value={packageId} />
          <input type="hidden" name="dateKey" value={dateKey} />
          <div className="flex items-center justify-between">
            <label htmlFor="ringkasan-editor" className="text-sm font-medium text-ink">
              Teks ringkasan
            </label>
            {edited ? (
              <button
                type="button"
                onClick={() => setShowAi((v) => !v)}
                className="text-xs text-primary hover:underline"
              >
                {showAi ? "Sembunyikan draf AI asli" : "Lihat draf AI asli"}
              </button>
            ) : null}
          </div>
          <Textarea
            id="ringkasan-editor"
            name="summaryText"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
            className="text-sm"
          />
          <p className="text-xs text-ink-faint">
            {text.trim().length} karakter · sunting bebas; yang tersimpan inilah yang dikirim.
          </p>
          {showAi && aiText ? (
            <div className="rounded-md border border-dashed border-border bg-surface-inset p-2">
              <p className="mb-1 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Draf AI asli
              </p>
              <p className="text-xs whitespace-pre-wrap text-ink-muted">{aiText}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              name="mode"
              value="simpan"
              variant="secondary"
              size="sm"
              disabled={editPending}
            >
              Simpan editan
            </Button>
            <Button
              type="submit"
              name="mode"
              value="final"
              size="sm"
              disabled={editPending || !canFinalize(status)}
            >
              {status === "final" || status === "sent" ? "Sudah final" : "Finalkan"}
            </Button>
          </div>
          {editState?.error ? <p className="text-xs text-danger">{editState.error}</p> : null}
          {editState?.success ? <p className="text-xs text-success">{editState.success}</p> : null}
        </form>
      ) : null}

      {/* Kirim */}
      {exists ? (
        <form action={sendAction} className="space-y-2 border-t border-border-muted pt-3">
          <input type="hidden" name="packageId" value={packageId} />
          <input type="hidden" name="dateKey" value={dateKey} />
          <label htmlFor="kirim-kontak" className="block text-sm font-medium text-ink">
            Kirim ke WhatsApp
          </label>
          <div className="flex flex-wrap gap-2">
            <Combobox
              id="kirim-kontak"
              name="contactId"
              defaultValue={contacts[0]?.id ?? ""}
              className="min-w-0 flex-1"
              disabled={contacts.length === 0 || !canSend(status)}
            >
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Combobox>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={sendPending || contacts.length === 0 || !canSend(status)}
              loading={sendPending}
            >
              {status === "sent" ? "Kirim ulang" : "Kirim"}
            </Button>
          </div>
          {!canSend(status) ? (
            <p className="text-xs text-ink-muted">Finalkan dulu sebelum mengirim ke pimpinan.</p>
          ) : null}
          {contacts.length === 0 ? (
            <p className="text-xs text-ink-muted">Tambah kontak di Master Data → Kontak WA.</p>
          ) : null}
          {sendState?.error ? <p className="text-xs text-danger">{sendState.error}</p> : null}
          {sendState?.success ? <p className="text-xs text-success">{sendState.success}</p> : null}
        </form>
      ) : null}

      {/* Jejak */}
      {timeline.length > 0 ? (
        <div className="border-t border-border-muted pt-3">
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            Jejak penyusunan
          </p>
          <ol className="space-y-1.5">
            {timeline.map((t, i) => (
              <li key={i} className="flex gap-2 text-xs">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                <span className="text-ink-muted">
                  <span className="font-medium text-ink">{t.label}</span> · {t.at}
                  {t.by ? ` · ${t.by}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
