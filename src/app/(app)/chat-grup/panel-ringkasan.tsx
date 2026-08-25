"use client";

import { useActionState, useState } from "react";
import { Badge, Button, Combobox, Textarea } from "@/components/ui";
import { Copy, Send, Sparkles } from "lucide-react";
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

export type PanelRingkasanProps = {
  packageId: string;
  dateKey: string;
  dateLabel: string;
  status: SummaryViewStatus;
  /** Teks tersimpan (hasil AI atau editan manusia). */
  summaryText: string;
  /** Draf AI asli — untuk membandingkan bila sudah disunting. */
  aiText: string | null;
  confidence: number | null;
  version: number;
  messageCount: number | null;
  generatedByName: string | null;
  updatedLabel: string | null;
  providerLabel: string | null;
  /** Alasan tombol "Hasilkan draft" mati; null = boleh jalan. */
  blockedReason: string | null;
  timeline: TimelineItem[];
  contacts: { id: string; name: string }[];
};

/**
 * Panel kanan "Ringkasan AI" (rombak 2026-08-24 mengikuti referensi user):
 * tanggal + chip status, kotak preview/editor draft, tombol besar "Hasilkan
 * draft AI", blok "Aksi lainnya" (Simpan draft · Salin · Teruskan ke
 * pimpinan), dan tabel "Status draft". Siklus hidup TIDAK berubah:
 * draft_ai → edited_draft → final → sent; draf AI tidak pernah otomatis final
 * dan kiriman ke pimpinan tetap butuh finalisasi (DECISIONS 139).
 */
export function PanelRingkasan(props: PanelRingkasanProps) {
  const {
    packageId,
    dateKey,
    dateLabel,
    status,
    summaryText,
    aiText,
    confidence,
    version,
    messageCount,
    generatedByName,
    updatedLabel,
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
  const [copied, setCopied] = useState(false);

  const exists = status !== "belum_dibuat";
  const edited = aiText != null && aiText.trim() !== summaryText.trim();

  const salin = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard bisa diblokir browser — tidak fatal */
    }
  };

  return (
    <div className="space-y-4">
      {/* Tanggal + status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">Tanggal</p>
          <p className="text-sm font-medium text-ink">{dateLabel}</p>
        </div>
        <Badge tone={SUMMARY_STATUS_TONE[status]} label={SUMMARY_STATUS_LABEL[status]} />
      </div>
      <p className="text-xs text-ink-muted">{SUMMARY_STATUS_HINT[status]}</p>

      {/* Preview / editor draft */}
      {exists ? (
        <form action={editAction} className="space-y-2">
          <input type="hidden" name="packageId" value={packageId} />
          <input type="hidden" name="dateKey" value={dateKey} />
          <div className="flex items-center justify-between">
            <label htmlFor="ringkasan-editor" className="text-sm font-medium text-ink">
              Preview draft
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
            rows={12}
            className="text-sm"
          />
          <p className="text-xs text-ink-faint">
            {text.trim().length} karakter · sunting bebas; yang tersimpan inilah yang dikirim.
          </p>
          {confidence != null ? (
            <div>
              <p className="text-xs text-ink-muted">
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
              </p>
              <div
                className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-inset"
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
            </div>
          ) : null}
          {showAi && aiText ? (
            <div className="rounded-md border border-dashed border-border bg-surface-inset p-2">
              <p className="mb-1 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Draf AI asli
              </p>
              <p className="text-xs whitespace-pre-wrap text-ink-muted">{aiText}</p>
            </div>
          ) : null}

          {/* Aksi lainnya (bagian editor) */}
          <p className="pt-1 text-[11px] font-medium tracking-wide text-ink-muted uppercase">Aksi lainnya</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="mode" value="simpan" variant="secondary" size="sm" disabled={editPending}>
              Simpan draft
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={salin}>
              <Copy aria-hidden className="size-3.5" />
              {copied ? "Tersalin" : "Salin"}
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
      ) : (
        <div className="rounded-md border border-dashed border-border bg-surface-inset/60 p-4 text-center">
          <p className="text-sm text-ink-muted">Belum ada draft untuk tanggal ini.</p>
          <p className="mt-1 text-xs text-ink-faint">
            Hanya pesan yang ditandai relevan yang dipakai menyusun draft.
          </p>
        </div>
      )}

      {/* Hasilkan / susun ulang draft */}
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
          {genPending ? (
            "Menyusun draft…"
          ) : (
            <>
              <Sparkles aria-hidden className="size-4" />
              {exists ? "Susun ulang draft AI" : "Hasilkan draft AI"}
            </>
          )}
        </Button>
        {blockedReason ? <p className="mt-1 text-xs text-ink-muted">{blockedReason}</p> : null}
        {exists && !blockedReason ? (
          <p className="mt-1 text-xs text-ink-muted">
            Menyusun ulang menimpa teks saat ini dan mengembalikan status ke draf AI.
          </p>
        ) : null}
        {genState?.error ? <p className="mt-1 text-xs text-danger">{genState.error}</p> : null}
      </form>

      {/* Teruskan ke pimpinan */}
      {exists ? (
        <form action={sendAction} className="space-y-2 border-t border-border-muted pt-3">
          <input type="hidden" name="packageId" value={packageId} />
          <input type="hidden" name="dateKey" value={dateKey} />
          <label htmlFor="kirim-kontak" className="block text-sm font-medium text-ink">
            Teruskan ke pimpinan
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
              <Send aria-hidden className="size-3.5" />
              {status === "sent" ? "Kirim ulang" : "Kirim"}
            </Button>
          </div>
          {!canSend(status) ? (
            <p className="text-xs text-ink-muted">Finalkan dulu sebelum meneruskan ke pimpinan.</p>
          ) : null}
          {contacts.length === 0 ? (
            <p className="text-xs text-ink-muted">Tambah kontak di Master Data → Kontak WA.</p>
          ) : null}
          {sendState?.error ? <p className="text-xs text-danger">{sendState.error}</p> : null}
          {sendState?.success ? <p className="text-xs text-success">{sendState.success}</p> : null}
        </form>
      ) : null}

      {/* Status draft */}
      {exists ? (
        <div className="border-t border-border-muted pt-3">
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">Status draft</p>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Draft terakhir</dt>
              <dd className="text-right font-medium text-ink">
                versi {version} · {SUMMARY_STATUS_LABEL[status]}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Dibuat oleh</dt>
              <dd className="text-right font-medium text-ink">{generatedByName ?? "–"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Diperbarui</dt>
              <dd className="text-right font-medium text-ink">{updatedLabel ?? "–"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Sumber pesan</dt>
              <dd className="text-right font-medium text-ink">
                {messageCount != null ? `${messageCount} pesan relevan` : "–"}
              </dd>
            </div>
          </dl>
          {providerLabel ? <p className="mt-2 text-[11px] text-ink-faint">{providerLabel}</p> : null}
        </div>
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
