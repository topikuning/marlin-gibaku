"use client";

import { useActionState } from "react";
import { createAdendum } from "./actions";

export function AdendumForm({ contractId }: { contractId: string }) {
  const [state, action, pending] = useActionState(createAdendum, undefined);

  const inp =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]";
  const label = "block text-xs font-medium text-slate-500 mb-1";

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="contractId" value={contractId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Nomor CCO / Adendum *</label>
          <input name="ccoNumber" required className={inp} placeholder="CCO-01" />
        </div>
        <div>
          <label className={label}>Tanggal berlaku *</label>
          <input name="effectiveDate" type="date" required className={inp} />
        </div>
        <div>
          <label className={label}>Perubahan nilai (Rp, boleh minus)</label>
          <input name="valueDelta" inputMode="text" className={inp} placeholder="mis. -150000000" />
        </div>
        <div>
          <label className={label}>Perubahan waktu (hari, boleh minus)</label>
          <input name="endDateDelta" inputMode="numeric" className={inp} placeholder="mis. 30" />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Alasan / lingkup *</label>
          <input name="reason" required className={inp} placeholder="Tambah kurang volume pekerjaan…" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#172554] disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Tambah Adendum"}
        </button>
        {state?.ok && <span className="text-sm text-[#15803D]">{state.ok}</span>}
        {state?.error && <span className="text-sm text-[#DC2626]">{state.error}</span>}
      </div>
    </form>
  );
}
