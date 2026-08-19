"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { PemilihLokasi } from "@/components/knmp/pemilih-lokasi";
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
  citations: {
    sourceRefId: string;
    note: string | null;
    /** Kalimat sumber yang bisa dibaca; null utk pesan lama (DECISIONS 378). */
    label?: string | null;
    value?: string | null;
    href?: string | null;
  }[];
  confidence: number | null;
  runId: string | null;
};

/** Chat Ask MARLIN: percakapan tersimpan, jawaban bersitasi + confidence. */
export function AskClient({
  conversation,
  locations,
  aiReady,
}: {
  conversation: {
    id: string;
    scopeIds: string[];
    scopeCount: number;
    periodStart: string;
    periodEnd: string;
    messages: Msg[];
  } | null;
  locations: { id: string; name: string; packageName?: string | null }[];
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
        action={
          conversation ? (
            // Doktrin DECISIONS 193: jawaban tidak berhenti sebagai teks chat —
            // scope percakapan terbawa ke Report Studio jadi artefak ber-lifecycle.
            <Link
              href={`/ai/reports?template=wa_update&scopeIds=${conversation.scopeIds.join(",")}`}
              className="text-[13px] font-medium text-primary hover:underline"
            >
              Buat laporan dari scope ini →
            </Link>
          ) : undefined
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
                  <div className="mt-1.5 border-t border-border-muted pt-1 text-[11px] text-ink-faint">
                    <p>
                      {/*
                        Keyakinan 0 disebut APA ADANYA, bukan disembunyikan: ia
                        berarti tidak satu pun angka di jawaban ini cocok dengan
                        data resmi beserta sumbernya (DECISIONS 378).
                      */}
                      {m.confidence != null ? (
                        <span className={m.confidence === 0 ? "font-medium text-danger" : undefined}>
                          {m.confidence === 0 ? "tanpa sumber terverifikasi" : `keyakinan ${m.confidence}%`}
                        </span>
                      ) : null}
                      {m.runId ? (
                        <>
                          {m.confidence != null ? " · " : ""}
                          <Link href={`/ai/run/${m.runId}`} className="text-primary hover:underline">
                            detail run
                          </Link>
                        </>
                      ) : null}
                    </p>
                    {m.citations.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {m.citations.map((c) => (
                          <li key={c.sourceRefId} className="min-w-0">
                            {/*
                              Sumber yang BISA DIBACA dan DIKLIK. Sebelumnya
                              baris ini menampilkan id mentah
                              ("kedung-mutih:progress") — yang tidak menyebut
                              angka apa yang dirujuk, dan tidak bisa diperiksa.
                              Pesan lama tidak menyimpan label; id-nya tetap
                              ditampilkan supaya riwayat tidak jadi kosong.
                            */}
                            {c.href ? (
                              <Link href={c.href} className="text-primary hover:underline">
                                {c.label ?? c.sourceRefId}
                              </Link>
                            ) : (
                              <span>{c.label ?? c.sourceRefId}</span>
                            )}
                            {c.value ? <span className="text-ink-faint"> — {c.value}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>sumber: —</p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <PemilihLokasi
            locations={locations}
            selected={selected}
            onChange={setSelected}
            maxTinggi="max-h-56"
            petunjukKosong="Belum ada lokasi dipilih — pertanyaan dijawab atas seluruh lokasi yang Anda pegang."
          />
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
