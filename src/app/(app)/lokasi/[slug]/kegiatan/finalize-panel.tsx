"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import {
  finalizeActivityWithTextAction,
  suggestActivityRewriteAction,
  type FieldActivityState,
  type SuggestRewriteState,
} from "@/lib/field-activity/actions";
import {
  REWRITE_FIELD_LABEL,
  REWRITE_STYLE_HINT,
  REWRITE_STYLE_LABEL,
  type RewriteField,
  type RewriteStyle,
} from "@/lib/field-activity/rewrite";

/**
 * Finalisasi kegiatan dengan opsi perapian teks (DECISIONS 179).
 *
 * Pola yang diminta user: orang lapangan mengisi semuanya dulu tanpa diganggu;
 * saat MENFINALKAN barulah muncul pilihan "Rapikan bahasa" / "Bahasa teknis" —
 * sekali untuk seluruh teks bebas. Hasilnya ditampilkan asli-vs-usulan per
 * bagian dengan centang masing-masing, dan finalisasi hanya menyimpan bagian
 * yang dicentang. "Finalkan apa adanya" tetap tersedia sebagai jalan tercepat.
 */
export function FinalizePanel({ activityId }: { activityId: string }) {
  const [open, setOpen] = useState(false);
  const [suggest, suggestAction, suggesting] = useActionState<SuggestRewriteState, FormData>(
    suggestActivityRewriteAction,
    undefined,
  );
  const [finalState, finalizeAction, finalizing] = useActionState<FieldActivityState, FormData>(
    finalizeActivityWithTextAction,
    undefined,
  );
  const [dipakai, setDipakai] = useState<Record<string, boolean>>({});

  const usable = (suggest?.fields ?? []).filter((f) => f.suggestion);
  const ditolak = (suggest?.fields ?? []).filter((f) => !f.suggestion);

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <CheckCircle2 aria-hidden className="size-3.5" />
          Finalkan
        </Button>
        {finalState?.error ? <span className="text-xs text-danger-700">{finalState.error}</span> : null}
      </div>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-md border border-border bg-surface-muted p-3">
      {suggest?.error ? <Banner tone="warning" title={suggest.error} /> : null}
      {finalState?.error ? <Banner tone="error" title={finalState.error} /> : null}

      {/* Langkah 1 — pilih gaya (atau lewati) */}
      {!suggest?.fields ? (
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-ink">Rapikan teks sebelum difinalkan?</p>
          <div className="flex flex-wrap gap-2">
            {(["rapi", "teknis"] as RewriteStyle[]).map((style) => (
              <form key={style} action={suggestAction}>
                <input type="hidden" name="activityId" value={activityId} />
                <input type="hidden" name="style" value={style} />
                <Button type="submit" size="sm" variant="secondary" disabled={suggesting}>
                  <Sparkles aria-hidden className="size-3.5" />
                  {suggesting ? "Memproses…" : REWRITE_STYLE_LABEL[style]}
                </Button>
              </form>
            ))}
            <form action={finalizeAction}>
              <input type="hidden" name="activityId" value={activityId} />
              <Button type="submit" size="sm" disabled={finalizing}>
                Finalkan apa adanya
              </Button>
            </form>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Batal
            </Button>
          </div>
          <p className="text-xs text-ink-muted">
            {REWRITE_STYLE_LABEL.rapi}: {REWRITE_STYLE_HINT.rapi} · {REWRITE_STYLE_LABEL.teknis}:{" "}
            {REWRITE_STYLE_HINT.teknis} AI hanya mengubah bahasa – angka & fakta tidak boleh berubah.
          </p>
        </div>
      ) : null}

      {/* Langkah 2 — pratinjau asli vs usulan, centang yang dipakai */}
      {suggest?.fields ? (
        <form action={finalizeAction} className="space-y-3">
          <input type="hidden" name="activityId" value={activityId} />
          <p className="text-[13px] font-medium text-ink">
            Usulan {suggest.style === "teknis" ? "bahasa teknis" : "perapian bahasa"} – centang yang dipakai
          </p>

          {usable.map((f) => {
            const key = f.field as RewriteField;
            const aktif = dipakai[key] ?? true;
            return (
              <div key={key} className="space-y-1.5 rounded-md border border-border bg-surface p-2.5">
                <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={aktif}
                    onChange={(e) => setDipakai((s) => ({ ...s, [key]: e.target.checked }))}
                    className="accent-primary"
                  />
                  {REWRITE_FIELD_LABEL[key]}
                </label>
                {aktif ? <input type="hidden" name={key} value={f.suggestion ?? ""} /> : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded bg-surface-inset p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Asli</p>
                    <p className="whitespace-pre-wrap text-xs text-ink-muted">{f.original}</p>
                  </div>
                  <div className="rounded bg-primary-50 p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-primary-700">
                      Usulan
                    </p>
                    <p className="whitespace-pre-wrap text-xs text-ink">{f.suggestion}</p>
                  </div>
                </div>
                {f.note ? <p className="text-xs text-warning-700">{f.note}</p> : null}
              </div>
            );
          })}

          {ditolak.length > 0 ? (
            <p className="text-xs text-ink-muted">
              Tidak diusulkan:{" "}
              {ditolak.map((f) => `${REWRITE_FIELD_LABEL[f.field as RewriteField]} (${f.rejected})`).join("; ")}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border pt-2">
            <Button type="submit" size="sm" loading={finalizing}>
              Pakai &amp; finalkan
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Batal
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
