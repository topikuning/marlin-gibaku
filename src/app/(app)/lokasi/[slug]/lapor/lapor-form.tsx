"use client";

import { useActionState, useMemo, useRef, useState, useEffect } from "react";
import { submitDraftItem } from "./actions";
import type { ReportableItem } from "@/lib/rab";

export function LaporForm({
  locationId,
  slug,
  items,
}: {
  locationId: string;
  slug: string;
  items: ReportableItem[];
}) {
  const [state, formAction, isPending] = useActionState(submitDraftItem, undefined);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReportableItem | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset setelah sukses.
  useEffect(() => {
    if (state?.ok) {
      setPicked(null);
      setQuery("");
      setPreviews([]);
      formRef.current?.reset();
    }
  }, [state?.ok]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((it) => `${it.code} ${it.name}`.toLowerCase().includes(q))
      .slice(0, 25);
  }, [query, items]);

  function onFiles() {
    const files = fileRef.current?.files;
    if (!files) return setPreviews([]);
    const urls: string[] = [];
    for (let i = 0; i < Math.min(files.length, 6); i++) urls.push(URL.createObjectURL(files[i]));
    setPreviews(urls);
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="rabItemId" value={picked?.id ?? ""} />

      {/* 1. Pilih item pekerjaan */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">
          1 · Pekerjaan
        </label>
        {picked ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#0F766E] bg-[#F0FDFA] px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[#0F172A]">{picked.name}</div>
              <div className="text-xs text-[#0F766E]">
                {picked.code} · satuan {picked.unit}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="shrink-0 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#64748B]"
            >
              Ganti
            </button>
          </div>
        ) : (
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputMode="search"
              placeholder="Ketik nama / kode pekerjaan…"
              className="w-full rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 text-base outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15"
            />
            {query && (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white">
                {matches.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-[#64748B]">Tidak ada yang cocok.</div>
                ) : (
                  matches.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => {
                        setPicked(it);
                        setQuery("");
                      }}
                      className="block w-full border-b border-[#F1F5F9] px-4 py-3 text-left last:border-0 active:bg-[#F0FDFA]"
                    >
                      <div className="text-sm font-medium text-[#0F172A]">{it.name}</div>
                      <div className="text-xs text-[#64748B]">
                        {it.code} · {it.unit}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 2. Volume */}
      <div>
        <label htmlFor="volumeDone" className="mb-1.5 block text-sm font-semibold text-[#0F172A]">
          2 · Volume selesai {picked?.unit ? `(${picked.unit})` : ""}
        </label>
        <input
          id="volumeDone"
          name="volumeDone"
          type="number"
          inputMode="decimal"
          step="0.001"
          min="0"
          required
          placeholder="mis. 3.2"
          className="w-full rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 text-2xl font-semibold tabular-nums outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15"
        />
      </div>

      {/* 3. Foto */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">3 · Foto bukti</label>
        <input
          ref={fileRef}
          id="photos"
          name="photos"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={onFiles}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#0F766E]/40 bg-[#F0FDFA] px-4 py-4 text-sm font-semibold text-[#0F766E] active:bg-[#DCFCE7]"
        >
          📷 {previews.length > 0 ? `${previews.length} foto dipilih — ketuk untuk ubah` : "Ambil / pilih foto"}
        </button>
        {previews.length > 0 && (
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {previews.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt="" className="h-16 w-full rounded-lg border border-[#E2E8F0] object-cover" />
            ))}
          </div>
        )}
      </div>

      {/* Catatan opsional */}
      <div>
        <label htmlFor="notes" className="mb-1.5 block text-sm font-semibold text-[#0F172A]">
          Catatan <span className="font-normal text-[#94A3B8]">(opsional)</span>
        </label>
        <input
          id="notes"
          name="notes"
          maxLength={500}
          placeholder="mis. cor kolom L2 utara"
          className="w-full rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 text-base outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15"
        />
      </div>

      {state?.error && (
        <div role="alert" className="rounded-xl border-l-4 border-[#DC2626] bg-[#FEE2E2] px-4 py-3 text-sm text-[#DC2626]">
          {state.error}
        </div>
      )}
      {state?.ok && (
        <div role="status" className="rounded-xl border-l-4 border-[#16A34A] bg-[#DCFCE7] px-4 py-3 text-sm text-[#16A34A]">
          {state.ok}
        </div>
      )}

      {/* Sticky submit (mobile) */}
      <div className="sticky bottom-3 z-10">
        <button
          type="submit"
          disabled={isPending || !picked}
          className="w-full rounded-xl bg-[#0F766E] px-4 py-4 text-base font-bold text-white shadow-lg transition active:bg-[#115E59] disabled:opacity-50"
        >
          {isPending ? "Menyimpan…" : "Simpan laporan"}
        </button>
      </div>
    </form>
  );
}
