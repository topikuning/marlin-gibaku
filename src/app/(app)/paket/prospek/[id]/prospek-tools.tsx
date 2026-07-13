"use client";

import { useActionState, useState } from "react";
import type { DocumentStage } from "@prisma/client";
import { STAGE_ORDER, STAGE_LABEL, TYPE_LABEL, TYPES_BY_STAGE } from "@/lib/documents";
import { updateProspek, uploadProspekDocument } from "../actions";

const inp = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]";
const lbl = "block text-xs font-medium text-slate-500 mb-1";

export function ProspekEdit({
  prospek,
}: {
  prospek: { id: string; name: string; packageNumber: string | null; hpsValue: string; province: string | null; contractorName: string | null; note: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateProspek, undefined);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm font-medium text-[#1e3a8a] hover:underline">
        ✎ Ubah data paket
      </button>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <input type="hidden" name="id" value={prospek.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={lbl}>Nama paket *</label>
          <input name="name" required defaultValue={prospek.name} className={inp} />
        </div>
        <div><label className={lbl}>Nomor paket</label><input name="packageNumber" defaultValue={prospek.packageNumber ?? ""} className={inp} /></div>
        <div><label className={lbl}>Provinsi</label><input name="province" defaultValue={prospek.province ?? ""} className={inp} /></div>
        <div><label className={lbl}>Nilai HPS (Rp)</label><input name="hpsValue" inputMode="numeric" defaultValue={prospek.hpsValue} className={inp} /></div>
        <div><label className={lbl}>Calon penyedia</label><input name="contractorName" defaultValue={prospek.contractorName ?? ""} className={inp} /></div>
        <div className="sm:col-span-2"><label className={lbl}>Catatan</label><textarea name="note" rows={2} defaultValue={prospek.note ?? ""} className={inp} /></div>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#172554] disabled:opacity-60">
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">Tutup</button>
        {state?.ok && <span className="text-sm text-[#15803D]">{state.ok}</span>}
        {state?.error && <span className="text-sm text-[#DC2626]">{state.error}</span>}
      </div>
    </form>
  );
}

export function ProspekDocUpload({ prospekId }: { prospekId: string }) {
  const [state, action, pending] = useActionState(uploadProspekDocument, undefined);
  const [stage, setStage] = useState<DocumentStage>("pemilihan");
  const types = TYPES_BY_STAGE[stage];

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="prospekId" value={prospekId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>Tahap *</label>
          <select name="stage" value={stage} onChange={(e) => setStage(e.target.value as DocumentStage)} className={inp}>
            {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Jenis dokumen *</label>
          <select name="type" required defaultValue="" className={inp}>
            <option value="" disabled>— pilih —</option>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2"><label className={lbl}>Judul / perihal *</label><input name="title" required className={inp} placeholder="mis. Undangan tender KNMP" /></div>
        <div><label className={lbl}>Nomor surat</label><input name="docNumber" className={inp} /></div>
        <div><label className={lbl}>Tanggal dokumen</label><input name="docDate" type="date" className={inp} /></div>
        <div className="sm:col-span-2">
          <label className={lbl}>Nilai HPS (Rp) — isi saat aanwijzing/penawaran</label>
          <input name="hpsValue" inputMode="numeric" className={inp} placeholder="kosongkan kalau bukan tahap HPS" />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>File * (PDF/gambar/Word/Excel, maks 15 MB)</label>
          <input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
            className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#1e3a8a] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#172554] disabled:opacity-60">
          {pending ? "Mengunggah…" : "Unggah dokumen"}
        </button>
        {state?.ok && <span className="text-sm text-[#15803D]">{state.ok}</span>}
        {state?.error && <span className="text-sm text-[#DC2626]">{state.error}</span>}
      </div>
    </form>
  );
}
