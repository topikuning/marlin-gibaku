"use client";

import { useActionState } from "react";
import Link from "next/link";
import { convertToContract } from "../actions";

export function ConvertForm({
  prospekId,
  defaultContractor,
  hpsLabel,
}: {
  prospekId: string;
  defaultContractor: string;
  hpsLabel: string;
}) {
  const [state, action, pending] = useActionState(convertToContract, undefined);

  const inp =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]";
  const label = "block text-xs font-medium text-slate-500 mb-1";

  if (state?.ok) {
    return (
      <div className="rounded-lg border-l-4 border-[#16A34A] bg-[#DCFCE7] px-4 py-3 text-sm text-[#15803D]">
        {state.ok}{" "}
        <Link href="/lokasi" className="font-semibold underline">
          Buka daftar lokasi →
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="prospekId" value={prospekId} />
      <p className="text-xs text-slate-500">HPS paket: {hpsLabel}. Isi nilai final setelah negosiasi.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label}>Nomor kontrak *</label>
          <input name="contractNumber" required className={inp} />
        </div>
        <div>
          <label className={label}>Nilai kontrak final (Rp) *</label>
          <input name="contractValue" inputMode="numeric" required className={inp} placeholder="0" />
        </div>
        <div>
          <label className={label}>Kontraktor *</label>
          <input name="contractorName" defaultValue={defaultContractor} required className={inp} />
        </div>
        <div>
          <label className={label}>Tanggal tanda tangan *</label>
          <input name="signedDate" type="date" required className={inp} />
        </div>
        <div>
          <label className={label}>Mulai kerja *</label>
          <input name="startDate" type="date" required className={inp} />
        </div>
        <div>
          <label className={label}>Selesai (rencana) *</label>
          <input name="endDate" type="date" required className={inp} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[#16A34A] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#15803D] disabled:opacity-60"
        >
          {pending ? "Memproses…" : "Jadikan Kontrak"}
        </button>
        {state?.error && <span className="text-sm text-[#DC2626]">{state.error}</span>}
      </div>
    </form>
  );
}
