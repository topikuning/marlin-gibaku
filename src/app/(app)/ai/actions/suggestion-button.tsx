"use client";

import { useAksi } from "@/lib/aksi-klien";


import { Button } from "@/components/ui";
import { saveSuggestionAction, type AiHubState } from "@/lib/ai-hub/actions";

/** Tombol simpan satu item antrean sebagai DRAFT artefak saran (non-eksekusi). */
export function SuggestionButton(props: {
  title: string;
  detail: string;
  category: string;
  severity: string;
  locationId: string;
  locationName: string;
  suggestKind: "action" | "recovery";
}) {
  const [state, formAction, pending] = useAksi<AiHubState>(saveSuggestionAction, undefined);
  const saved = !!state?.ok;
  return (
    <form action={formAction} className="shrink-0 text-right">
      <input type="hidden" name="title" value={props.title.slice(0, 200)} />
      <input type="hidden" name="detail" value={props.detail.slice(0, 1000)} />
      <input type="hidden" name="category" value={props.category} />
      <input type="hidden" name="severity" value={props.severity} />
      <input type="hidden" name="locationId" value={props.locationId} />
      <input type="hidden" name="locationName" value={props.locationName} />
      <input type="hidden" name="suggestKind" value={props.suggestKind} />
      <Button type="submit" size="sm" variant={saved ? "ghost" : "secondary"} disabled={pending || saved}>
        {saved ? "Draft tersimpan ✓" : pending ? "Menyimpan…" : props.suggestKind === "recovery" ? "Draft Recovery" : "Draft Action"}
      </Button>
      {state?.error ? <p className="mt-1 max-w-48 text-[11px] text-danger">{state.error}</p> : null}
    </form>
  );
}
