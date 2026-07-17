"use client";

import { useState, useTransition } from "react";
import { Banner, Button, HelpText, Input, Label, Textarea } from "@/components/ui";
import { formatRupiah } from "@/lib/format";
import { importHps, type ImportState } from "./actions";

/**
 * Impor RAB 2 langkah tanpa perlu unggah ulang: file disimpan di STATE klien,
 * jadi "Simpan" memakai file yang sama dgn pratinjau. Memilih file baru otomatis
 * mereset ke mode Pratinjau (isi bisa berubah — jangan langsung simpan).
 */
export function ImportForm({ locationId }: { locationId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [state, setState] = useState<ImportState>(undefined);
  const [pending, startTransition] = useTransition();
  const preview = state?.preview;

  function run(confirm: boolean) {
    if (!file) {
      setState({ error: "Pilih file HPS/RAB (.xlsx) dulu." });
      return;
    }
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("file", file);
    fd.set("note", note);
    if (confirm && preview) {
      fd.set("confirm", "1");
      fd.set("previewSha", preview.sha256);
    }
    startTransition(async () => {
      const res = await importHps(undefined, fd);
      setState(res);
      // Sukses simpan → bersihkan agar tidak tersimpan dobel.
      if (res?.success) {
        setFile(null);
        setNote("");
        setInputKey((k) => k + 1);
      }
    });
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    // File baru → buang pratinjau lama; tombol kembali jadi "Pratinjau".
    setState(undefined);
  }

  return (
    <div className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {preview?.notice ? <Banner tone="warning" title={preview.notice} /> : null}

      <div>
        <Label htmlFor="hps-file" required>File HPS / RAB (.xlsx)</Label>
        <Input
          key={inputKey}
          id="hps-file"
          name="file"
          type="file"
          accept=".xlsx,.xls"
          onChange={onFileChange}
          className="h-auto py-1.5"
        />
        <HelpText>
          Sheet &quot;RAB&quot; dibaca otomatis. Maksimal 15 MB.
          {file ? <span className="font-medium text-ink"> · dipilih: {file.name}</span> : null}
        </HelpText>
      </div>

      {preview ? (
        <div className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
          <Banner
            tone={preview.isAdendum ? "warning" : "info"}
            title={
              preview.isAdendum
                ? "Terdeteksi ADENDUM — lokasi sudah punya revisi RAB aktif"
                : "Impor HPS awal — belum ada revisi RAB aktif"
            }
            description={
              preview.isAdendum
                ? "Revisi baru akan menggantikan revisi aktif; realisasi item dgn lineage sama tersambung otomatis, dan baseline kurva-S di-regenerate."
                : "Revisi #1 akan dibuat dan baseline kurva-S dibuat otomatis."
            }
          />

          <div className="text-sm text-ink">
            <p className="font-medium">
              {preview.fileName}{" "}
              <span className="font-normal text-ink-muted">
                ({(preview.bytes / 1024).toFixed(0)} KB · {preview.itemCount} item pekerjaan)
              </span>
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                  <th className="py-1.5 pr-3">Kode</th>
                  <th className="py-1.5 pr-3">Kategori</th>
                  <th className="py-1.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.categories.map((c) => (
                  <tr key={c.code}>
                    <td className="py-1.5 pr-3 text-ink-muted">{c.code}</td>
                    <td className="py-1.5 pr-3">{c.name}</td>
                    <td className="tabular py-1.5 text-right">{formatRupiah(Number(c.total))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td colSpan={2} className="py-1.5 pr-3 text-right font-semibold">
                    Grand total (pra-PPN)
                  </td>
                  <td className="tabular py-1.5 text-right font-semibold">
                    {formatRupiah(Number(preview.grandTotal))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {preview.warnings.length > 0 ? (
            <Banner
              tone="warning"
              title={`${preview.warnings.length} peringatan parsing`}
              description={
                <ul className="list-disc pl-4">
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              }
            />
          ) : null}

          <div>
            <Label htmlFor="hps-note">Catatan revisi (opsional)</Label>
            <Textarea
              id="hps-note"
              name="note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. Adendum CCO-01, perubahan volume revetment"
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {preview ? (
          <>
            <Button type="button" loading={pending} onClick={() => run(true)}>
              Simpan &amp; aktifkan revisi
            </Button>
            <Button type="button" variant="secondary" loading={pending} onClick={() => run(false)}>
              Pratinjau ulang
            </Button>
          </>
        ) : (
          <Button type="button" loading={pending} disabled={!file} onClick={() => run(false)}>
            Pratinjau
          </Button>
        )}
      </div>
    </div>
  );
}
