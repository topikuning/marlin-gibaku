"use client";

import { useActionState } from "react";
import { Banner, Button, HelpText, Input, Label, Textarea } from "@/components/ui";
import { formatRupiah } from "@/lib/format";
import { importHps, type ImportState } from "./actions";

/**
 * Form impor 2 langkah dalam SATU form multipart:
 * langkah 1 pilih file → "Pratinjau" (tanpa simpan); langkah 2 form dikirim
 * ulang berikut file + hidden confirm=1 → simpan & aktifkan.
 */
export function ImportForm({ locationId }: { locationId: string }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importHps, undefined);
  const preview = state?.preview;

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {preview?.notice ? <Banner tone="warning" title={preview.notice} /> : null}

      <input type="hidden" name="locationId" value={locationId} />

      <div>
        <Label htmlFor="hps-file" required>File HPS / RAB (.xlsx)</Label>
        <Input id="hps-file" name="file" type="file" accept=".xlsx,.xls" required className="h-auto py-1.5" />
        <HelpText>Sheet &quot;RAB&quot; dibaca otomatis. Maksimal 15 MB.</HelpText>
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
            <Textarea id="hps-note" name="note" rows={2} maxLength={500} placeholder="mis. Adendum CCO-01, perubahan volume revetment" />
          </div>

          {/* Langkah 2: kirim ulang file yang sama + confirm. sha256 dicek server. */}
          <input type="hidden" name="confirm" value="1" />
          <input type="hidden" name="previewSha" value={preview.sha256} />
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" loading={pending}>
          {preview ? "Simpan & aktifkan revisi" : "Pratinjau"}
        </Button>
        {preview ? (
          <HelpText className="mt-0">
            Ganti file? Pilih file baru lalu klik simpan — sistem otomatis menampilkan pratinjau ulang.
          </HelpText>
        ) : null}
      </div>
    </form>
  );
}
