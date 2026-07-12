"use client";

import { useActionState } from "react";
import { savePlan, regeneratePlan } from "./actions";

type Milestone = { weekNumber: number; targetProgressPct: number };

const inputClass =
  "w-24 rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15";

export function EditForm({
  planId,
  locationId,
  slug,
  milestones,
}: {
  planId: string;
  locationId: string;
  slug: string;
  milestones: Milestone[];
}) {
  const [saveState, saveAction, saving] = useActionState(savePlan, undefined);
  const [regenState, regenAction, regenerating] = useActionState(regeneratePlan, undefined);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#64748B]">
          Edit target progres kumulatif (%) per minggu. Nilai harus naik (kumulatif).
        </p>
        <form action={regenAction}>
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="slug" value={slug} />
          <button
            type="submit"
            disabled={regenerating}
            className="rounded-md border border-[#0F766E] px-3 py-1.5 text-sm font-semibold text-[#0F766E] transition hover:bg-[#F1F5F9] disabled:opacity-60"
          >
            {regenerating ? "Menggenerate…" : "↻ Generate ulang dari rumus"}
          </button>
        </form>
      </div>

      {regenState?.ok && (
        <div role="status" className="rounded-md border-l-4 border-[#16A34A] bg-[#DCFCE7] px-3 py-2 text-sm text-[#16A34A]">
          {regenState.ok}
        </div>
      )}
      {regenState?.error && (
        <div role="alert" className="rounded-md border-l-4 border-[#DC2626] bg-[#FEE2E2] px-3 py-2 text-sm text-[#DC2626]">
          {regenState.error}
        </div>
      )}

      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="planId" value={planId} />
        <input type="hidden" name="slug" value={slug} />

        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {milestones.map((m) => (
            <label key={m.weekNumber} className="flex items-center justify-between gap-2 border-b border-[#F1F5F9] py-1">
              <span className="text-sm text-[#64748B]">Minggu {m.weekNumber}</span>
              <span className="flex items-center gap-1">
                <input
                  name={`w_${m.weekNumber}`}
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  defaultValue={m.targetProgressPct}
                  className={inputClass}
                />
                <span className="text-xs text-[#94A3B8]">%</span>
              </span>
            </label>
          ))}
        </div>

        {saveState?.ok && (
          <div role="status" className="rounded-md border-l-4 border-[#16A34A] bg-[#DCFCE7] px-3 py-2 text-sm text-[#16A34A]">
            {saveState.ok}
          </div>
        )}
        {saveState?.error && (
          <div role="alert" className="rounded-md border-l-4 border-[#DC2626] bg-[#FEE2E2] px-3 py-2 text-sm text-[#DC2626]">
            {saveState.error}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[#0F766E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#115E59] disabled:opacity-60"
        >
          {saving ? "Menyimpan…" : "Simpan kurva-S"}
        </button>
      </form>
    </div>
  );
}
