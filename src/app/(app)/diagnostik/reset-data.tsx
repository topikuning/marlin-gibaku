"use client";

import { useActionState } from "react";
import { resetData } from "./actions";

export function ResetData() {
  const [state, action, pending] = useActionState(resetData, undefined);

  return (
    <div>
      <p className="mb-2 text-sm text-slate-600">
        Menghapus <b>data operasional</b>: laporan harian, foto, entri biaya.
        <br />
        <span className="text-[#15803D]">Tetap aman:</span> lokasi, RAB, revisi,
        kurva-S &amp; jadwal, kontrak, pengguna, dokumen.
      </p>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input
          name="confirm"
          placeholder="ketik: KOSONGKAN"
          className="rounded-md border border-[#DC2626]/40 bg-white px-3 py-2 text-sm outline-none focus:border-[#DC2626]"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#B91C1C] disabled:opacity-60"
        >
          {pending ? "Mengosongkan…" : "Kosongkan Data Operasional"}
        </button>
      </form>
      {state?.ok && (
        <div role="status" className="mt-3 rounded-md border-l-4 border-[#16A34A] bg-[#DCFCE7] px-3 py-2 text-sm text-[#15803D]">
          {state.ok}
        </div>
      )}
      {state?.error && (
        <div role="alert" className="mt-3 rounded-md border-l-4 border-[#DC2626] bg-[#FEE2E2] px-3 py-2 text-sm text-[#DC2626]">
          {state.error}
        </div>
      )}
    </div>
  );
}
