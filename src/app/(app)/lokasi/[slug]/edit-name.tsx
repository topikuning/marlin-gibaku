"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { Banner, Button, Input } from "@/components/ui";
import { renameLocation, type PackageActionState } from "@/lib/package/actions";

/**
 * Nama lokasi di header workspace + tombol "Ubah nama" (inline) bila user punya
 * kapabilitas location.manage. Mengubah nama TAMPILAN saja (slug/URL tetap).
 * DECISIONS 117.
 */
export function EditableLocationName({
  locationId,
  name,
  canEdit,
}: {
  locationId: string;
  name: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<PackageActionState, FormData>(renameLocation, undefined);

  useEffect(() => {
    if (!state?.success) return;
    // setState via timeout (bukan sinkron di effect) — patuh react-hooks/set-state-in-effect.
    const t = window.setTimeout(() => setEditing(false), 0);
    return () => window.clearTimeout(t);
  }, [state?.success]);

  if (!canEdit) return <h1 className="text-xl font-semibold text-ink">{name}</h1>;

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <h1 className="text-xl font-semibold text-ink">{name}</h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Ubah nama lokasi"
          title="Ubah nama lokasi"
          className="text-ink-faint transition hover:text-primary"
        >
          <Pencil className="size-4" />
        </button>
      </span>
    );
  }

  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="locationId" value={locationId} />
      <Input
        name="name"
        defaultValue={name}
        minLength={3}
        maxLength={200}
        required
        autoFocus
        className="h-9 w-56 text-base font-semibold"
      />
      <Button type="submit" size="sm" loading={pending}>Simpan</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Batal</Button>
      {state?.error ? <Banner tone="error" title={state.error} className="w-full" /> : null}
    </form>
  );
}
