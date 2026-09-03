"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { suggestTextRewriteAction, type SuggestRewriteState } from "@/lib/field-activity/actions";
import {
  REWRITE_FIELD_LABEL,
  REWRITE_STYLE_HINT,
  REWRITE_STYLE_LABEL,
  type RewriteField,
  type RewriteStyle,
} from "@/lib/field-activity/rewrite";

/**
 * Tombol "Rapikan teks" yang berdiri sendiri di dalam form kegiatan.
 *
 * Keluhan user 2026-09-03: perapian bahasa hanya bisa dicapai lewat tombol
 * Finalkan — padahal merapikan kalimat itu bagian dari MENGETIK, bukan bagian
 * dari menutup kegiatan. Di sini ia jadi alat tulis biasa: tekan, lihat asli vs
 * usulan, centang yang dipakai, teksnya masuk ke kotak isian. Belum tersimpan —
 * yang menyimpan tetap tombol Simpan milik form (DECISIONS 178: usulan tidak
 * pernah menimpa tulisan orang tanpa diputuskan orangnya).
 *
 * Teks yang dirapikan diambil dari FORM tempat tombol ini berada (lewat
 * `closest("form")`), bukan dari basis data: saat mengetik, yang di layar belum
 * tentu yang tersimpan.
 */
const BAGIAN: RewriteField[] = ["notes", "kendala", "solusi"];

export function RapikanTeksPanel({ locationId }: { locationId: string }) {
  const jangkar = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SuggestRewriteState>(undefined);
  const [dipakai, setDipakai] = useState<Record<string, boolean>>({});
  const [pending, start] = useTransition();

  const formnya = () => jangkar.current?.closest("form") ?? null;

  const isiField = (form: HTMLFormElement, name: string): string => {
    const el = form.elements.namedItem(name);
    return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : "";
  };

  const minta = (style: RewriteStyle) => {
    const form = formnya();
    if (!form) return;
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("style", style);
    fd.set("type", isiField(form, "type"));
    fd.set("title", isiField(form, "title"));
    for (const f of BAGIAN) fd.set(f, isiField(form, f));
    setDipakai({});
    start(async () => {
      setState(await suggestTextRewriteAction(undefined, fd));
    });
  };

  const pakai = () => {
    const form = formnya();
    if (!form) return;
    for (const f of state?.fields ?? []) {
      if (!f.suggestion) continue;
      if (!(dipakai[f.field] ?? true)) continue;
      const el = form.elements.namedItem(f.field);
      if (el instanceof HTMLTextAreaElement) el.value = f.suggestion;
    }
    setState(undefined);
  };

  const usulan = (state?.fields ?? []).filter((f) => f.suggestion);
  const ditolak = (state?.fields ?? []).filter((f) => !f.suggestion);

  return (
    <div ref={jangkar} className="space-y-2 rounded-lg border border-border bg-surface-inset/40 p-3">
      {state?.error ? <Banner tone="warning" title={state.error} /> : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {(["rapi", "teknis"] as RewriteStyle[]).map((style) => (
          <Button
            key={style}
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => minta(style)}
          >
            <Sparkles aria-hidden className="size-3.5" />
            {pending ? "Memproses…" : REWRITE_STYLE_LABEL[style]}
          </Button>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-ink-muted">
        {REWRITE_STYLE_HINT.rapi} AI hanya mengubah bahasa – angka &amp; fakta tidak boleh berubah, dan
        tidak ada yang tersimpan sebelum Anda memakainya.
      </p>

      {usulan.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-2">
          <p className="text-[13px] font-medium text-ink">
            Usulan {state?.style === "teknis" ? "bahasa teknis" : "perapian bahasa"} – centang yang dipakai
          </p>
          {usulan.map((f) => {
            const key = f.field as RewriteField;
            const aktif = dipakai[key] ?? true;
            return (
              <div key={key} className="space-y-1.5 rounded-md border border-border bg-surface p-2.5">
                <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={aktif}
                    onChange={(e) => setDipakai((s) => ({ ...s, [key]: e.target.checked }))}
                    className="accent-primary"
                  />
                  {REWRITE_FIELD_LABEL[key]}
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded bg-surface-inset p-2">
                    <p className="mb-1 text-[10px] font-semibold tracking-wide text-ink-faint uppercase">Asli</p>
                    <p className="text-xs whitespace-pre-wrap text-ink-muted">{f.original}</p>
                  </div>
                  <div className="rounded bg-primary-50 p-2">
                    <p className="mb-1 text-[10px] font-semibold tracking-wide text-primary-700 uppercase">
                      Usulan
                    </p>
                    <p className="text-xs whitespace-pre-wrap text-ink">{f.suggestion}</p>
                  </div>
                </div>
                {f.note ? <p className="text-xs text-warning-700">{f.note}</p> : null}
              </div>
            );
          })}
          {ditolak.length > 0 ? (
            <p className="text-xs text-ink-muted">
              Tidak diusulkan:{" "}
              {ditolak.map((f) => `${REWRITE_FIELD_LABEL[f.field as RewriteField]} (${f.rejected})`).join("; ")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={pakai}>
              Pakai teks ini
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setState(undefined)}>
              Buang usulan
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
