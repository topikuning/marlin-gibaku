"use client";

import { useActionState, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Banner, Button, StatusPill, Textarea } from "@/components/ui";
import { resetPromptAction, savePromptAction, type PromptState } from "@/lib/ai/prompt-actions";
import { PROMPT_GROUP_LABEL, type PromptGroup } from "@/lib/ai/prompt-registry";

/**
 * Sistem → Prompt AI: satu tempat mengatur teks perintah SEMUA aksi AI
 * (AI Hub, laporan eksekutif WA, ringkasan chat grup, perapian teks kegiatan).
 * DECISIONS 180.
 *
 * Prompt yang belum pernah disetel menampilkan teks BAWAAN dan ditandai
 * "Bawaan"; yang sudah disetel ditandai "Diubah" dan bisa dikembalikan.
 * Frasa pengaman (mis. "AI BUKAN sumber angka") tidak boleh dihapus — server
 * menolak simpan dan menyebut frasa mana yang hilang.
 */

export type PromptItem = {
  key: string;
  group: string;
  label: string;
  description: string;
  text: string;
  isOverridden: boolean;
  defaultText: string;
  mustContain: string[];
  maxChars: number;
};

function PromptCard({ item }: { item: PromptItem }) {
  const [saveState, saveAction, saving] = useActionState<PromptState, FormData>(savePromptAction, undefined);
  const [resetState, resetAction, resetting] = useActionState<PromptState, FormData>(
    resetPromptAction,
    undefined,
  );
  const [text, setText] = useState(item.text);
  const [showDefault, setShowDefault] = useState(false);
  const state = saveState ?? resetState;
  const dirty = text.trim() !== item.text.trim();

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{item.label}</p>
          <p className="text-xs text-ink-muted">{item.description}</p>
        </div>
        <StatusPill tone={item.isOverridden ? "warning" : "neutral"}>
          {item.isOverridden ? "Diubah" : "Bawaan"}
        </StatusPill>
      </div>

      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      <form action={saveAction} className="space-y-2">
        <input type="hidden" name="key" value={item.key} />
        <Textarea
          name="text"
          rows={Math.min(16, Math.max(4, text.split("\n").length + 1))}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={item.maxChars}
          className="font-mono text-xs"
          aria-label={item.label}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={saving || !dirty}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
          {dirty ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setText(item.text)}>
              Batal
            </Button>
          ) : null}
          <span className="text-xs text-ink-muted">
            {text.trim().length}/{item.maxChars} karakter
          </span>
          <button
            type="button"
            onClick={() => setShowDefault((v) => !v)}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {showDefault ? "Sembunyikan bawaan" : "Lihat teks bawaan"}
          </button>
        </div>
      </form>

      {item.mustContain.length > 0 ? (
        <p className="text-xs text-ink-muted">
          Frasa pengaman yang wajib tetap ada:{" "}
          {item.mustContain.map((f) => (
            <code key={f} className="mr-1 rounded bg-surface-inset px-1 py-0.5 text-[11px]">
              {f}
            </code>
          ))}
        </p>
      ) : null}

      {showDefault ? (
        <pre className="max-h-56 overflow-auto rounded-md bg-surface-inset p-2 text-[11px] whitespace-pre-wrap text-ink-muted">
          {item.defaultText || "(tidak ada teks bawaan)"}
        </pre>
      ) : null}

      {item.isOverridden ? (
        <form action={resetAction}>
          <input type="hidden" name="key" value={item.key} />
          <Button type="submit" size="sm" variant="ghost" disabled={resetting}>
            <RotateCcw aria-hidden className="size-3.5" />
            {resetting ? "Mengembalikan…" : "Kembalikan ke bawaan"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function PromptPanel({ items }: { items: PromptItem[] }) {
  const groups = [...new Set(items.map((i) => i.group))] as PromptGroup[];
  const diubah = items.filter((i) => i.isOverridden).length;

  return (
    <div className="space-y-5">
      <Banner
        tone="info"
        title="Teks perintah untuk semua aksi AI"
        description={
          `Perubahan langsung berlaku pada aksi AI berikutnya – tanpa deploy. ` +
          `${diubah} dari ${items.length} prompt sedang memakai teks khusus. ` +
          `AI tetap bukan sumber angka: semua angka laporan berasal dari calculation layer, apa pun isi prompt di sini. ` +
          `Setiap prompt WAJIB tetap memuat larangan mengarang di luar sumber (“JANGAN MENGARANG”) – simpan ditolak bila frasa itu hilang.`
        }
      />

      {groups.map((g) => (
        <section key={g} className="space-y-2">
          <h3 className="text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            {PROMPT_GROUP_LABEL[g] ?? g}
          </h3>
          <div className="space-y-2">
            {items.filter((i) => i.group === g).map((item) => (
              <PromptCard key={item.key} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
