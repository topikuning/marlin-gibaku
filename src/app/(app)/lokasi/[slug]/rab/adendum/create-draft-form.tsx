"use client";

import { useActionState } from "react";
import { Banner, Button, Combobox } from "@/components/ui";
import { createDraftAction, type AdendumActionState } from "./actions";

export type AmendmentOption = {
  id: string;
  ccoNumber: string;
  effectiveDate: string; // ISO
  valueDelta: string; // BigInt string
};

const rupiah = new Intl.NumberFormat("id-ID");

/** Form pembuatan draft adendum — salinan penuh revisi aktif untuk diedit. */
export function CreateDraftForm({
  slug,
  amendments,
}: {
  slug: string;
  amendments: AmendmentOption[];
}) {
  const [state, formAction, pending] = useActionState<AdendumActionState, FormData>(
    createDraftAction,
    undefined,
  );
  return (
    <form action={formAction} className="max-w-xl space-y-3">
      <input type="hidden" name="slug" value={slug} />
      {amendments.length > 0 ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Kaitkan ke adendum kontrak (CCO)</span>
          <Combobox name="amendmentId" defaultValue="">
            <option value="">– Tanpa kaitan CCO (bisa dikaitkan belakangan) –</option>
            {amendments.map((a) => {
              const d = BigInt(a.valueDelta);
              return (
                <option key={a.id} value={a.id}>
                  {a.ccoNumber} · {d >= 0n ? "+" : "−"}Rp {rupiah.format(d < 0n ? -d : d)}
                </option>
              );
            })}
          </Combobox>
        </label>
      ) : (
        <p className="text-[13px] text-ink-muted">
          Belum ada adendum kontrak (CCO) tercatat di paket – draft tetap bisa dibuat, catat CCO-nya
          di halaman Kontrak paket bila sudah resmi.
        </p>
      )}
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Catatan (opsional)</span>
        <input
          name="note"
          placeholder="mis. Adendum 01 – pekerjaan tambah kurang"
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
