"use client";

import { useActionState, useRef, useState } from "react";
import { FileUp, Upload } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { importJadwalAction, type RabActionState } from "../rab/actions";

/**
 * Impor Time Schedule Excel (hasil "Unduh Excel Jadwal" yang diedit sipil) →
 * jadwal per kategori (matriks mingguan, boleh berjeda) → baseline baru.
 *
 * DEFAULT: angka Excel dipakai APA ADANYA, termasuk bobot tiap pekerjaan —
 * jadwal yang diunggah adalah pernyataan rencana penggunanya (DECISIONS 203).
 * Penyesuaian bobot ke RAB hanya kalau dicentang. DECISIONS 103/203.
 */
export function JadwalImport({ locationId }: { locationId: string }) {
  const [state, action, pending] = useActionState<RabActionState, FormData>(importJadwalAction, undefined);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sesuaikan, setSesuaikan] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="text-xs text-ink-muted">
        Punya jadwal dari Excel? Unduh dulu lewat tombol <span className="font-medium">Unduh Excel Jadwal</span>,
        sunting rentang/nilai minggu (boleh dikosongkan = jeda), lalu impor kembali di sini.{" "}
        <span className="font-medium text-ink">Angka di Excel dipakai apa adanya</span> — bobot tiap pekerjaan
        mengikuti file Anda, bukan dihitung ulang oleh sistem. Tersimpan sebagai baseline baru (bisa dipulihkan
        lewat Riwayat baseline).
      </p>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="locationId" value={locationId} />
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
        <Button type="button" size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
          <FileUp aria-hidden className="size-3.5" />
          Pilih file Excel…
        </Button>
        {fileName ? <span className="max-w-56 truncate text-xs text-ink-muted">{fileName}</span> : null}
        <Button type="submit" size="sm" loading={pending} disabled={!fileName}>
          <Upload aria-hidden className="size-3.5" />
          Impor jadwal dari Excel
        </Button>
        <label className="flex w-full items-start gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            name="sesuaikanRab"
            value="1"
            checked={sesuaikan}
            onChange={(e) => setSesuaikan(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-(--color-primary)"
          />
          <span>
            Sesuaikan bobot ke RAB — sistem menskalakan tiap pekerjaan agar bobotnya sama dengan RAB
            (bentuk &amp; jeda dari Excel tetap dipakai), dan pekerjaan yang belum dijadwalkan di Excel diisi
            otomatis. <span className="text-ink-muted/80">Kosongkan bila jadwal Anda sudah final.</span>
          </span>
        </label>
      </form>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
    </div>
  );
}
