"use client";

import { useActionState } from "react";
import { submitDraftItem } from "./actions";
import type { ReportableItem } from "@/lib/rab";

const inputClass =
  "w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15";
const labelClass = "block text-xs font-semibold text-[#0F766E] mb-1";

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
        <div role="alert" className="rounded-md border-l-4 border-[#DC2626] bg-[#FEE2E2] px-3 py-2 text-sm text-[#DC2626]">
          {state.error}
        </div>
      )}
      {state?.ok && (
        <div role="status" className="rounded-md border-l-4 border-[#16A34A] bg-[#DCFCE7] px-3 py-2 text-sm text-[#16A34A]">
          {state.ok}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-[#0F766E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#115E59] disabled:opacity-60"
      >
        {isPending ? "Menyimpan…" : "Simpan draft laporan"}
      </button>
    </form>
  );
}
