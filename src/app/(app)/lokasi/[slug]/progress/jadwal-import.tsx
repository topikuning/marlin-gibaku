"use client";

import { useActionState, useRef, useState } from "react";
import { FileUp, Upload } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { importJadwalAction, type RabActionState } from "../rab/actions";

/**
 * Impor Time Schedule Excel (hasil "Unduh Excel Jadwal" yang diedit sipil) →
 * jadwal per kategori (matriks mingguan, boleh berjeda) → baseline baru. Bobot
 * di-renormalisasi ke RAB; bentuk & jeda dari Excel dipertahankan. DECISIONS 103.
 */
export function JadwalImport({ locationId }: { locationId: string }) {
  const [state, action, pending] = useActionState<RabActionState, FormData>(importJadwalAction, undefined);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="text-xs text-ink-muted">
        Punya jadwal dari Excel? Unduh dulu lewat tombol <span className="font-medium">Unduh Excel Jadwal</span>,
        sunting rentang/nilai minggu (boleh dikosongkan = jeda), lalu impor kembali di sini. Bobot tetap
        mengikuti RAB; bentuk &amp; jeda dari Excel dipertahankan. Tersimpan sebagai baseline baru (bisa
        dipulihkan lewat Riwayat baseline).
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
      </form>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
    </div>
  );
}
