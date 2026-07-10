"use client";

import { useActionState } from "react";
import { submitDraftItem } from "./actions";
import type { ReportableItem } from "@/lib/rab";

const inputClass =
  "w-full rounded-md border border-[#EAE2D2] bg-white px-3 py-2 text-sm outline-none focus:border-[#3A4E63] focus:ring-2 focus:ring-[#3A4E63]/15";
const labelClass = "block text-xs font-semibold text-[#3A4E63] mb-1";

export function LaporForm({
  locationId,
  slug,
  items,
}: {
  locationId: string;
  slug: string;
  items: ReportableItem[];
}) {
  const [state, formAction, isPending] = useActionState(
    submitDraftItem,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="slug" value={slug} />

      <div>
        <label htmlFor="rabItemId" className={labelClass}>
          Item pekerjaan (RAB) *
        </label>
        <select id="rabItemId" name="rabItemId" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            — pilih item —
          </option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.code} — {it.name} ({it.unit})
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="volumeDone" className={labelClass}>
            Volume selesai *
          </label>
          <input
            id="volumeDone"
            name="volumeDone"
            type="number"
            step="0.001"
            min="0"
            required
            className={inputClass}
            placeholder="mis. 3.2"
          />
        </div>
        <div>
          <label htmlFor="notes" className={labelClass}>
            Catatan (opsional)
          </label>
          <input id="notes" name="notes" maxLength={500} className={inputClass} placeholder="mis. cor kolom L2 utara" />
        </div>
      </div>

      {state?.error && (
        <div role="alert" className="rounded-md border-l-4 border-[#C1442E] bg-[#FCE8E4] px-3 py-2 text-sm text-[#C1442E]">
          {state.error}
        </div>
      )}
      {state?.ok && (
        <div role="status" className="rounded-md border-l-4 border-[#2E7D4F] bg-[#E4F0E8] px-3 py-2 text-sm text-[#2E7D4F]">
          {state.ok}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-[#3A4E63] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2c3d4f] disabled:opacity-60"
      >
        {isPending ? "Menyimpan…" : "Simpan draft laporan"}
      </button>
    </form>
  );
}
