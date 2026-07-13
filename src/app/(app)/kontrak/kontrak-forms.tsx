"use client";

import { useActionState } from "react";
import { createContractor, createContract } from "./actions";

const inputClass =
  "w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/15";
const labelClass = "block text-xs font-semibold text-[#1e3a8a] mb-1";

function Alert({ state }: { state?: { ok?: string; error?: string } }) {
  if (state?.error)
    return (
      <div role="alert" className="rounded-md border-l-4 border-[#DC2626] bg-[#FEE2E2] px-3 py-2 text-sm text-[#DC2626]">
        {state.error}
      </div>
    );
  if (state?.ok)
    return (
      <div role="status" className="rounded-md border-l-4 border-[#16A34A] bg-[#DCFCE7] px-3 py-2 text-sm text-[#16A34A]">
        {state.ok}
      </div>
    );
  return null;
}

export function ContractorForm() {
  const [state, action, pending] = useActionState(createContractor, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="c-name" className={labelClass}>Nama Kontraktor *</label>
          <input id="c-name" name="name" required className={inputClass} placeholder="PT ..." />
        </div>
        <div>
          <label htmlFor="c-npwp" className={labelClass}>NPWP (opsional)</label>
          <input id="c-npwp" name="npwp" className={inputClass} />
        </div>
      </div>
      <Alert state={state} />
      <button type="submit" disabled={pending} className="rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#172554] disabled:opacity-60">
        {pending ? "Menyimpan…" : "Tambah Kontraktor"}
      </button>
    </form>
  );
}

export function ContractForm({ contractors }: { contractors: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createContract, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="k-contractor" className={labelClass}>Kontraktor *</label>
          <select id="k-contractor" name="contractorId" required defaultValue="" className={inputClass}>
            <option value="" disabled>— pilih kontraktor —</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="k-number" className={labelClass}>Nomor SPK *</label>
          <input id="k-number" name="contractNumber" required className={inputClass} placeholder="SPK-KNMP-2026-..." />
        </div>
        <div>
          <label htmlFor="k-value" className={labelClass}>Nilai Kontrak (Rp) *</label>
          <input id="k-value" name="contractValue" type="number" min="0" step="1" required className={inputClass} placeholder="3000000000" />
        </div>
        <div>
          <label htmlFor="k-signed" className={labelClass}>Tanggal Tanda Tangan *</label>
          <input id="k-signed" name="signedDate" type="date" required className={inputClass} />
        </div>
        <div>
          <label htmlFor="k-start" className={labelClass}>Mulai *</label>
          <input id="k-start" name="startDate" type="date" required className={inputClass} />
        </div>
        <div>
          <label htmlFor="k-end" className={labelClass}>Selesai *</label>
          <input id="k-end" name="endDate" type="date" required className={inputClass} />
        </div>
      </div>
      <Alert state={state} />
      <button type="submit" disabled={pending || contractors.length === 0} className="rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#172554] disabled:opacity-60">
        {pending ? "Menyimpan…" : "Tambah Kontrak"}
      </button>
      {contractors.length === 0 && (
        <p className="text-xs text-[#64748B]">Tambah kontraktor dulu sebelum bikin kontrak.</p>
      )}
    </form>
  );
}
