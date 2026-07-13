"use client";

import { useActionState, useRef, useState } from "react";
import { createProspek } from "../actions";

type Lok = { name: string; village: string; regency: string; province: string; gpsLat: string; gpsLng: string };

export function ProspekForm() {
  const [state, action, pending] = useActionState(createProspek, undefined);
  const [lokasi, setLokasi] = useState<Lok[]>([
    { name: "", village: "", regency: "", province: "", gpsLat: "", gpsLng: "" },
  ]);
  const ref = useRef<HTMLInputElement>(null);

  const inp =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]";
  const label = "block text-xs font-medium text-slate-500 mb-1";
  const set = (i: number, k: keyof Lok, v: string) =>
    setLokasi((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <form
      action={action}
      onSubmit={() => {
        if (ref.current) ref.current.value = JSON.stringify(lokasi.filter((l) => l.name.trim()));
      }}
      className="space-y-6"
    >
      <input type="hidden" name="lokasi" ref={ref} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label}>Nama paket *</label>
          <input name="name" required className={inp} placeholder="Pembangunan KNMP Wilayah …" />
        </div>
        <div>
          <label className={label}>Nomor paket / tender</label>
          <input name="packageNumber" className={inp} />
        </div>
        <div>
          <label className={label}>Provinsi</label>
          <input name="province" className={inp} placeholder="Jawa Tengah" />
        </div>
        <div>
          <label className={label}>Nilai HPS (Rp)</label>
          <input name="hpsValue" inputMode="numeric" className={inp} placeholder="0" />
        </div>
        <div>
          <label className={label}>Calon penyedia</label>
          <input name="contractorName" className={inp} placeholder="PT / CV …" />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Catatan</label>
          <textarea name="note" rows={2} className={inp} />
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-slate-900">Desa / lokasi target</div>
        <p className="mb-3 text-xs text-slate-500">
          Satu paket bisa mencakup beberapa desa. Saat jadi kontrak, tiap baris jadi lokasi real.
        </p>
        <div className="space-y-2">
          {lokasi.map((l, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-6">
              <input value={l.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="Nama lokasi/KNMP *" className={`${inp} sm:col-span-2`} />
              <input value={l.village} onChange={(e) => set(i, "village", e.target.value)} placeholder="Desa" className={inp} />
              <input value={l.regency} onChange={(e) => set(i, "regency", e.target.value)} placeholder="Kabupaten" className={inp} />
              <input value={l.gpsLat} onChange={(e) => set(i, "gpsLat", e.target.value)} placeholder="Lat (opsional)" className={inp} />
              <div className="flex gap-2">
                <input value={l.gpsLng} onChange={(e) => set(i, "gpsLng", e.target.value)} placeholder="Lng" className={inp} />
                <button
                  type="button"
                  onClick={() => setLokasi((s) => s.filter((_, j) => j !== i))}
                  className="shrink-0 rounded-md border border-slate-200 px-2 text-xs text-slate-500 hover:bg-slate-50"
                  aria-label="Hapus"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLokasi((s) => [...s, { name: "", village: "", regency: "", province: "", gpsLat: "", gpsLng: "" }])}
          className="mt-2 text-sm font-medium text-[#1e3a8a] hover:underline"
        >
          + Tambah lokasi
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[#1e3a8a] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#172554] disabled:opacity-60"
        >
          {pending ? "Menyimpan…" : "Simpan Prospek"}
        </button>
        {state?.error && <span className="text-sm text-[#DC2626]">{state.error}</span>}
      </div>
    </form>
  );
}
