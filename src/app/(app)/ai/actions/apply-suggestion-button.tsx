"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState } from "react";
import { Button } from "@/components/ui";
import { terapkanSaranAction, type AiHubState } from "@/lib/ai-hub/actions";

/**
 * Terapkan satu draft saran menjadi Kendala nyata di lokasi (+ aksi pemulihan
 * untuk draft recovery). Inilah jalan eksekusinya: sebelum ada tombol ini,
 * draft tersimpan tidak pernah menjadi apa pun (DECISIONS 195).
 *
 * PIC & tanggal target hanya ditanyakan untuk draft recovery — Kendala biasa
 * tidak punya dua field itu.
 */
export function ApplySuggestionButton({
  artifactId,
  recovery,
}: {
  artifactId: string;
  recovery: boolean;
}) {
  const [state, formAction, pending] = useAksi<AiHubState>(
    terapkanSaranAction,
    undefined,
  );
  const [open, setOpen] = useState(false);
  const done = !!state?.ok;

  if (done) {
    return <p className="mt-1 text-[11px] text-success">{state.ok}</p>;
  }

  if (!open) {
    return (
      <div className="mt-1.5">
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Terapkan jadi {recovery ? "Kendala + Recovery" : "Kendala"}
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-1.5 space-y-1.5">
      <input type="hidden" name="artifactId" value={artifactId} />
      {recovery ? (
        <div className="flex flex-wrap gap-1.5">
          <input
            name="picName"
            placeholder="PIC (opsional)"
            maxLength={120}
            className="h-8 w-32 rounded-md border border-border bg-surface px-2 text-xs"
          />
          <input
            name="dueDate"
            type="date"
            className="h-8 w-36 rounded-md border border-border bg-surface px-2 text-xs"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Button type="submit" size="sm" loading={pending}>
          Buat sekarang
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
      {state?.error ? <p className="text-[11px] text-danger">{state.error}</p> : null}
    </form>
  );
}
