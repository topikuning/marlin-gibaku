"use client";

import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import {
  commitMasterImportAction,
  previewMasterImportAction,
  type MasterImportState,
} from "@/lib/master-location/actions";

/**
 * Impor batch katalog lokasi: pilih .xlsx → Pratinjau (ringkasan) → Simpan.
 * File ditahan di state klien (React 19 me-reset input form action) supaya
 * simpan tak perlu unggah ulang — sama pola dgn impor RAB.
 */
export function MasterImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<MasterImportState>(undefined);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const preview = state?.preview;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setState(undefined); // file baru → kembali ke mode pratinjau
  }

  function run(commit: boolean) {
    if (!file) {
      setState({ error: "Pilih file xlsx dulu." });
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const action = commit ? commitMasterImportAction : previewMasterImportAction;
      const res = await action(undefined, fd);
      setState(res);
      if (commit && res?.success) {
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  }

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted hover:border-border-strong">
        <Upload aria-hidden className="size-4" />
        {file ? file.name : "Pilih file .xlsx"}
        <input ref={inputRef} type="file" accept=".xlsx" className="sr-only" onChange={onFile} />
      </label>

      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      {preview ? (
        <div className="rounded-md border border-border bg-surface-muted p-3 text-sm">
          <p className="font-semibold text-ink">Pratinjau impor</p>
          <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[13px] text-ink sm:grid-cols-3">
            <li>Baris terbaca: <b>{preview.parsed}</b></li>
            <li>Unik: <b>{preview.unique}</b></li>
            <li>Lokasi baru: <b className="text-success">{preview.newCatalog}</b></li>
            <li>Diperbarui: <b>{preview.updateCatalog}</b></li>
            <li>Sudah ada sbg lokasi: <b className="text-warning">{preview.alreadyReal}</b></li>
            <li>Vendor baru: <b>{preview.vendorsNew}</b>/{preview.vendorsInFile}</li>
          </ul>
          {preview.warnings.length > 0 ? (
            <p className="mt-2 text-[12px] text-warning">{preview.warnings.join(" ")}</p>
          ) : null}
          {preview.sample.length > 0 ? (
            <div className="mt-2 text-[12px] text-ink-muted">
              Contoh:{" "}
              {preview.sample.map((s) => `${s.village} (${s.regency})`).join(" · ")}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!preview ? (
          <Button type="button" onClick={() => run(false)} loading={pending} disabled={!file}>
            Pratinjau
          </Button>
        ) : (
          <>
            <Button type="button" onClick={() => run(true)} loading={pending}>
              Simpan ke katalog
            </Button>
            <Button type="button" variant="secondary" onClick={() => run(false)} loading={pending}>
              Pratinjau ulang
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
