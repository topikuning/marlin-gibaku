"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload } from "lucide-react";
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
      {/* TEMPLAT — teguran user 2026-09-06: *"templatenya mana, kok gak ada"*.
          Impor tanpa templat berarti kolom yang dibaca cuma bisa ditebak. */}
      <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5 text-[13px] text-ink-muted">
        <a
          href="/master/lokasi/template"
          className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
        >
          <Download aria-hidden className="size-3.5" />
          Unduh templat Excel
        </a>
        <p className="mt-1">
          Berisi kolom yang dibaca MARLIN beserta petunjuknya. Berkas MASTER DATA KNMP bisa langsung
          diunggah apa adanya – sheet yang dibaca <b>MASTER DATA</b>, dan hanya lokasi berstatus
          aktif yang diimpor. Data perusahaan tidak diambil.
        </p>
      </div>

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
            <li>Baris aktif terbaca: <b>{preview.parsed}</b></li>
            <li>Unik: <b>{preview.unique}</b></li>
            <li>Lokasi baru: <b className="text-success">{preview.newCatalog}</b></li>
            <li>Diperbarui: <b>{preview.updateCatalog}</b></li>
            <li>Sudah ada sbg lokasi: <b className="text-warning">{preview.alreadyReal}</b></li>
            <li>Berkoordinat: <b>{preview.berkoordinat}</b>/{preview.unique}</li>
            {preview.tidakAktif > 0 ? (
              <li className="col-span-2 sm:col-span-3">
                Tidak aktif (dilewati): <b className="text-warning">{preview.tidakAktif}</b>
              </li>
            ) : null}
          </ul>
          {preview.sheet ? (
            <p className="mt-1 text-[12px] text-ink-muted">
              Sheet yang dibaca: <b>{preview.sheet}</b>
            </p>
          ) : null}
          {preview.warnings.length > 0 ? (
            <p className="mt-2 text-[12px] text-warning">{preview.warnings.join(" ")}</p>
          ) : null}
          {preview.sample.length > 0 ? (
            <div className="mt-2 text-[12px] text-ink-muted">
              Contoh:{" "}
              {preview.sample
                .map((s) => `${s.village} (${s.regency})`)
                .join(" · ")}
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
