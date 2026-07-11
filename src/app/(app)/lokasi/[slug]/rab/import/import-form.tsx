"use client";

import { useActionState } from "react";
import { previewImport, commitImport } from "./actions";
import { formatRupiah } from "@/lib/format";

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15";

export function ImportForm({ locationId, slug }: { locationId: string; slug: string }) {
  const [pv, previewAction, previewing] = useActionState(previewImport, undefined);
  const [cm, commitAction, committing] = useActionState(commitImport, undefined);

  if (cm?.ok) {
    return (
      <div className="rounded-lg border border-[#16A34A] bg-[#DCFCE7] p-4 text-sm text-[#15803D]">
        ✓ {cm.ok}{" "}
        <a href={`/lokasi/${slug}/rab`} className="font-semibold underline">
          Lihat RAB aktif →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step 1: upload + preview */}
      <form action={previewAction} className="space-y-3">
        <input type="hidden" name="locationId" value={locationId} />
        <label className="block text-xs font-semibold text-[#0F766E]">
          File HPS (.xlsx) — sheet ‘RAB’ akan dibaca
        </label>
        <input
          name="file"
          type="file"
          required
          accept=".xlsx,.xls"
          className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#0F766E] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
        />
        {pv?.error && (
          <div role="alert" className="rounded-md border-l-4 border-[#DC2626] bg-[#FEE2E2] px-3 py-2 text-sm text-[#DC2626]">
            {pv.error}
          </div>
        )}
        <button
          type="submit"
          disabled={previewing}
          className="rounded-md border border-[#0F766E] px-4 py-2 text-sm font-semibold text-[#0F766E] transition hover:bg-[#F1F5F9] disabled:opacity-60"
        >
          {previewing ? "Membaca…" : "Baca & Preview"}
        </button>
      </form>

      {/* Step 2: preview + confirm */}
      {pv?.preview && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900">Preview RAB</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                pv.preview.isAdendum ? "bg-[#FEF3C7] text-[#B45309]" : "bg-[#DCFCE7] text-[#16A34A]"
              }`}
            >
              {pv.preview.isAdendum ? "ADENDUM (revisi baru)" : "RAB awal"}
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            {pv.preview.fileName} · {pv.preview.categories.length} kategori · Grand total{" "}
            <span className="font-semibold text-slate-900">{formatRupiah(pv.preview.grandTotal)}</span>
          </p>

          {pv.preview.warnings.length > 0 && (
            <div className="mb-3 rounded-md border-l-4 border-[#B45309] bg-[#FEF3C7] px-3 py-2 text-xs text-[#B45309]">
              {pv.preview.warnings.slice(0, 5).map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}

          <div className="mb-4 max-h-56 overflow-y-auto rounded-md border border-slate-100">
            <table className="w-full text-sm">
              <tbody>
                {pv.preview.categories.map((c) => (
                  <tr key={c.roman + c.name} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-1.5 text-slate-400">{c.roman}</td>
                    <td className="px-3 py-1.5 text-slate-900">{c.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                      {formatRupiah(c.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pv.preview.isAdendum && (
            <p className="mb-3 rounded-md bg-[#FEF3C7] px-3 py-2 text-xs text-[#B45309]">
              Menyimpan akan menjadikan ini <b>revisi aktif</b>; revisi lama jadi arsip
              (superseded). Realisasi yang sudah disetujui tetap terhitung untuk item
              berkode sama.
            </p>
          )}

          <form action={commitAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="locationId" value={locationId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="r2Key" value={pv.preview.r2Key} />
            <input type="hidden" name="fileName" value={pv.preview.fileName} />
            <input type="hidden" name="mimeType" value={pv.preview.mimeType} />
            <input type="hidden" name="bytes" value={pv.preview.bytes} />
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold text-[#0F766E]">
                Catatan revisi (opsional)
              </label>
              <input name="note" className={inputClass} placeholder="mis. CCO-01: tambah volume revetment" />
            </div>
            <button
              type="submit"
              disabled={committing}
              className="rounded-md bg-[#0F766E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#115E59] disabled:opacity-60"
            >
              {committing ? "Menyimpan…" : "Konfirmasi & Simpan Revisi"}
            </button>
          </form>
          {cm?.error && (
            <div role="alert" className="mt-2 rounded-md border-l-4 border-[#DC2626] bg-[#FEE2E2] px-3 py-2 text-sm text-[#DC2626]">
              {cm.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
