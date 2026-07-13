"use client";

import { useActionState } from "react";
import { resetData, resetAllData } from "./actions";

type State = { ok?: string; error?: string } | undefined;

function Result({ state }: { state: State }) {
  if (state?.ok)
    return (
      <div role="status" className="mt-3 rounded-md border-l-4 border-[#16A34A] bg-[#DCFCE7] px-3 py-2 text-sm text-[#15803D]">
        {state.ok}
      </div>
    );
  if (state?.error)
    return (
      <div role="alert" className="mt-3 rounded-md border-l-4 border-[#DC2626] bg-[#FEE2E2] px-3 py-2 text-sm text-[#DC2626]">
        {state.error}
      </div>
    );
  return null;
}

export function ResetData() {
  const [opState, opAction, opPending] = useActionState(resetData, undefined);
  const [allState, allAction, allPending] = useActionState(resetAllData, undefined);

  return (
    <div className="space-y-6">
      {/* Reset penuh — mulai dari nol (untuk data real) */}
      <div>
        <div className="mb-1 text-sm font-semibold text-[#0F172A]">
          Reset penuh — mulai dari nol
        </div>
        <p className="mb-2 text-sm text-slate-600">
          Untuk memulai dengan <b>data real</b>. Menghapus <b>SEMUA data contoh</b>:
          kontrak, lokasi, RAB, kurva-S, laporan, dokumen, keuangan — semuanya.
          <br />
          <span className="text-[#15803D]">Tetap:</span> akun login (pengguna) &amp;
          cara perhitungan kurva-S/jadwal (itu kode, selalu ada).
        </p>
        <form action={allAction} className="flex flex-wrap items-center gap-2">
          <input
            name="confirm"
            placeholder="ketik: RESET SEMUA"
            className="rounded-md border border-[#DC2626]/40 bg-white px-3 py-2 text-sm outline-none focus:border-[#DC2626]"
          />
          <button
            type="submit"
            disabled={allPending}
            className="rounded-md bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#B91C1C] disabled:opacity-60"
          >
            {allPending ? "Mereset…" : "Reset Penuh (Mulai dari Nol)"}
          </button>
        </form>
        <Result state={allState} />
      </div>

      <hr className="border-slate-200" />

      {/* Reset operasional saja (master real tetap) */}
      <div>
        <div className="mb-1 text-sm font-semibold text-[#0F172A]">
          Kosongkan data operasional saja
        </div>
        <p className="mb-2 text-sm text-slate-600">
          Hapus <b>laporan harian, foto, entri biaya</b> saja.{" "}
          <span className="text-[#15803D]">Tetap:</span> lokasi, RAB, kurva-S,
          kontrak, pengguna, dokumen. (Untuk membersihkan laporan uji tanpa
          kehilangan master real.)
        </p>
        <form action={opAction} className="flex flex-wrap items-center gap-2">
          <input
            name="confirm"
            placeholder="ketik: KOSONGKAN"
            className="rounded-md border border-[#DC2626]/40 bg-white px-3 py-2 text-sm outline-none focus:border-[#DC2626]"
          />
          <button
            type="submit"
            disabled={opPending}
            className="rounded-md border border-[#DC2626] px-4 py-2 text-sm font-semibold text-[#DC2626] transition hover:bg-[#FEE2E2] disabled:opacity-60"
          >
            {opPending ? "Mengosongkan…" : "Kosongkan Data Operasional"}
          </button>
        </form>
        <Result state={opState} />
      </div>
    </div>
  );
}
