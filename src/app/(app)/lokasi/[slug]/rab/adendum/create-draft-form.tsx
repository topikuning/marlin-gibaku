"use client";

import { useActionState } from "react";
import { Banner, Button } from "@/components/ui";
import { createDraftAction, type AdendumActionState } from "./actions";

/** Form pembuatan draft adendum — salinan penuh revisi aktif untuk diedit. */
export function CreateDraftForm({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState<AdendumActionState, FormData>(
    createDraftAction,
    undefined,
  );
  return (
    <form action={formAction} className="max-w-xl space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Catatan (opsional)</span>
        <input
          name="note"
          placeholder="mis. Adendum 01 — pekerjaan tambah kurang"
          className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-sm"
        />
      </label>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <Button type="submit" loading={pending}>
        Buat draft adendum dari revisi aktif
      </Button>
    </form>
  );
}
