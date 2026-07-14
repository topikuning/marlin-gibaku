"use client";

import { useActionState } from "react";
import { Banner, Button, Label, Select, Textarea } from "@/components/ui";
import { changeLocationStatus, type StatusActionState } from "./actions";
import type { LocationStatus } from "@/generated/prisma/enums";

/** Form ubah status lokasi — target sudah difilter mesin transisi di server component. */
export function LocationStatusForm({
  locationId,
  targets,
}: {
  locationId: string;
  /** Transisi valid dari status sekarang: [value, label]. */
  targets: [LocationStatus, string][];
}) {
  const [state, action, pending] = useActionState<StatusActionState, FormData>(
    changeLocationStatus,
    undefined,
  );

  if (targets.length === 0) {
    return <p className="text-sm text-ink-muted">Status sudah final — tidak ada transisi lanjutan.</p>;
  }

  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="locationId" value={locationId} />
      <div>
        <Label htmlFor="ls-status" required>Status baru</Label>
        <Select id="ls-status" name="toStatus" required defaultValue={targets[0][0]}>
          {targets.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="ls-note">Catatan (opsional)</Label>
        <Textarea id="ls-note" name="note" rows={2} maxLength={500} placeholder="Alasan perubahan status…" />
      </div>
      <Button type="submit" loading={pending}>Ubah status</Button>
    </form>
  );
}
