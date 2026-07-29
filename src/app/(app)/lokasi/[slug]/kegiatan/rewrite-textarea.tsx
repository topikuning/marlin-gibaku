"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button, Textarea } from "@/components/ui";
import {
  rewriteActivityTextAction,
  type RewriteState,
} from "@/lib/field-activity/actions";
import { REWRITE_MIN_CHARS, type RewriteField } from "@/lib/field-activity/rewrite";

/**
 * Textarea teks bebas kegiatan lapangan + tombol "Rapikan dengan AI".
 *
 * Alurnya SENGAJA dua langkah: AI mengusulkan, orangnya yang memutuskan.
 * Usulan ditampilkan berdampingan dengan teks asli; menekan "Pakai" hanya
 * mengganti isi kotak — penyimpanan tetap lewat tombol simpan form seperti
 * biasa. Tidak ada tulisan lapangan yang berubah diam-diam (DECISIONS 178).
 *
 * Aksi dipanggil langsung (bukan lewat <form> bersarang, yang tidak sah di
 * HTML) memakai useTransition, sehingga tombol ini tidak ikut mengirim form
 * induknya.
 */
export function RewriteTextarea({
  id,
  name,
  locationId,
  field,
  rows = 2,
  defaultValue = "",
  placeholder,
  maxLength = 2000,
  kindLabel,
  title,
}: {
  id: string;
  name: string;
  locationId: string;
  field: RewriteField;
  rows?: number;
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;
  kindLabel?: string | null;
  title?: string | null;
}) {
  const [value, setValue] = useState(defaultValue);
  const [state, setState] = useState<RewriteState>(undefined);
  const [pending, startTransition] = useTransition();

  const tooShort = value.trim().length < REWRITE_MIN_CHARS;

  const minta = () => {
    setState(undefined);
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("field", field);
    fd.set("text", value);
    if (kindLabel) fd.set("kindLabel", kindLabel);
    if (title) fd.set("title", title);
    startTransition(async () => {
      const hasil = await rewriteActivityTextAction(undefined, fd);
      setState(hasil);
    });
  };

  return (
    <div className="space-y-1.5">
      <Textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={minta}
          disabled={pending || tooShort}
          title={tooShort ? "Tulis dulu beberapa kata" : "Usulkan versi rapi (Anda yang memutuskan)"}
        >
          <Sparkles className="size-3.5" aria-hidden />
          {pending ? "Merapikan…" : "Rapikan dengan AI"}
        </Button>
        <span className="text-xs text-ink-muted">
          {tooShort ? "Tulis dulu beberapa kata." : "AI hanya merapikan bahasa — angka & fakta tidak diubah."}
        </span>
      </div>

      {state?.error ? (
        <p className="rounded-md bg-danger-50 px-2.5 py-1.5 text-xs text-danger-700">{state.error}</p>
      ) : null}

      {state?.suggestion ? (
        <div className="space-y-2 rounded-md border border-primary-200 bg-primary-50 p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-primary-700">Usulan AI</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{state.suggestion}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setValue(state.suggestion!);
                setState(undefined);
              }}
            >
              Pakai
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setState(undefined)}>
              Buang usulan
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
