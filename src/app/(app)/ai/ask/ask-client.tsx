"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { askMarlinAction, type AiHubState } from "@/lib/ai-hub/actions";

const QUICK_QUESTIONS = [
  "Lokasi mana yang paling perlu tindakan?",
  "Mana yang readiness datanya terburuk, dan kenapa?",
  "Apa data yang belum dapat dipercaya?",
  "Buat narasi WhatsApp singkat untuk pimpinan.",
];

type Msg = {
  id: string;
  role: string;
  content: string;
  citations: { sourceRefId: string; note: string | null }[];
  confidence: number | null;
  runId: string | null;
};

/** Chat Ask MARLIN: percakapan tersimpan, jawaban bersitasi + confidence. */
export function AskClient({
  conversation,
  locations,
  aiReady,
}: {
  conversation: { id: string; scopeCount: number; periodStart: string; periodEnd: string; messages: Msg[] } | null;
  locations: { id: string; name: string }[];
  aiReady: boolean;
}) {
  const [state, formAction, pending] = useActionState<AiHubState, FormData>(askMarlinAction, undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState("");

  return (
    <Card>
      <CardHeader
        title="Ask MARLIN"
        subtitle={
          conversation
            ? `Scope ${conversation.scopeCount} lokasi · periode ${conversation.periodStart} – ${conversation.periodEnd} · grounded (hanya data yang Anda boleh akses)`
            : "Percakapan baru — pilih scope (kosong = semua lokasi Anda), lalu bertanya. Jawaban selalu menyertakan sumber."
        }
      />
      <CardBody className="space-y-3">
        {conversation ? (
          <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-md border border-border bg-surface-muted p-3" aria-live="polite">
            {conversation.messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user" ? "ml-auto bg-primary text-white" : "border border-border bg-surface text-ink"
                }`}
              >
                {m.content}
                {m.role !== "user" && (m.citations.length > 0 || m.confidence != null) ? (
                  <p className="mt-1.5 border-t border-border-muted pt-1 text-[11px] text-ink-faint">
                    {m.confidence != null ? `confidence ${m.confidence}% · ` : ""}
                    sumber: {m.citations.map((c) => c.sourceRefId).join(", ") || "—"}
                    {m.runId ? (
                      <>
                        {" · "}
                        <Link href={`/ai/run/${m.runId}`} className="text-primary hover:underline">
                          detail run
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {locations.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(l.id)}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(l.id)) next.delete(l.id);
                      else next.add(l.id);
                      return next;
                    })
                  }
                />
                <span className="truncate">{l.name}</span>
              </label>
            ))}
          </div>
        )}

        {state?.error ? <Banner tone="error" title={state.error} /> : null}

        <form action={formAction} className="space-y-2">
          {conversation ? (
            <input type="hidden" name="conversationId" value={conversation.id} />
          ) : (
            <>
              {[...selected].map((id) => (
                <input key={id} type="hidden" name="locationId" value={id} />
              ))}
              <input type="hidden" name="period" value="7hari" />
            </>
          )}
          <div className="flex gap-2">
            <input
              name="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Contoh: lokasi mana yang paling perlu tindakan hari ini?"
              aria-label="Pertanyaan untuk MARLIN"
              className="h-10 flex-1 rounded-md border border-border bg-surface px-3 text-sm"
              maxLength={1000}
            />
            <Button type="submit" disabled={!aiReady || pending || question.trim().length < 3}>
              {pending ? "Menjawab…" : "Kirim"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_QUESTIONS.map((qq) => (
              <button
                key={qq}
                type="button"
                onClick={() => setQuestion(qq)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted hover:border-primary hover:text-primary"
              >
                {qq}
              </button>
            ))}
          </div>
        </form>
        <p className="text-[11px] text-ink-faint">
          Ask MARLIN bersifat read-only: tidak pernah mengubah data. Jawaban di luar data yang diizinkan akan ditolak.
        </p>
      </CardBody>
    </Card>
  );
}
