"use client";

import { useActionState, useState } from "react";
import type { DocumentStage } from "@prisma/client";
import { uploadDocument } from "./actions";
import { STAGE_ORDER, STAGE_LABEL, TYPE_LABEL, TYPES_BY_STAGE } from "@/lib/documents";

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15";
const labelClass = "block text-xs font-semibold text-[#0F766E] mb-1";

export function UploadForm({ locationId, slug }: { locationId: string; slug: string }) {
  const [state, formAction, pending] = useActionState(uploadDocument, undefined);
  const [stage, setStage] = useState<DocumentStage>("kontrak");
  const types = TYPES_BY_STAGE[stage];

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="slug" value={slug} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="stage" className={labelClass}>Tahap *</label>
          <select
            id="stage"
            name="stage"
            required
            value={stage}
            onChange={(e) => setStage(e.target.value as DocumentStage)}
            className={inputClass}
          >
            {STAGE_ORDER.map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="type" className={labelClass}>Jenis Dokumen *</label>
          <select id="type" name="type" required defaultValue="" className={inputClass}>
            <option value="" disabled>— pilih jenis —</option>
            {types.map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="title" className={labelClass}>Judul / Perihal *</label>
          <input id="title" name="title" required className={inputClass} placeholder="mis. SPMK Kedung Mutih" />
        </div>
        <div>
          <label htmlFor="docNumber" className={labelClass}>Nomor Surat (opsional)</label>
          <input id="docNumber" name="docNumber" className={inputClass} />
        </div>
        <div>
          <label htmlFor="docDate" className={labelClass}>Tanggal Dokumen (opsional)</label>
          <input id="docDate" name="docDate" type="date" className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="file" className={labelClass}>File * (PDF/gambar/Word/Excel, maks 15 MB)</label>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
            className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#0F766E] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
          />
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
        disabled={pending}
        className="rounded-md bg-[#0F766E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#115E59] disabled:opacity-60"
      >
        {pending ? "Mengunggah…" : "Unggah Dokumen"}
      </button>
    </form>
  );
}
