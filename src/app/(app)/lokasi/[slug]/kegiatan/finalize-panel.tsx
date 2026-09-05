"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui";
import { finalizeActivityAction, type FieldActivityState } from "@/lib/field-activity/actions";

/**
 * Finalisasi kegiatan draft — MENUTUP kegiatan, tidak lebih.
 *
 * Ketetapan user 2026-09-05: *"yang dulu aku maksud untuk fitur ini ada bukan
 * saat difinalkan, itu bukan di sini, tapi di menu edit atau ketika inputan
 * sudah jadi laporan kegiatan"*. Karena itu langkah "Rapikan bahasa / Bahasa
 * teknis" yang dulu menempel di sini (DECISIONS 179) DIANGKAT dari jalur
 * finalisasi; tempatnya satu-satunya kini di form EDIT kegiatan yang sudah
 * tersimpan (`rapikan-teks.tsx`).
 *
 * Alasannya masuk akal dari sisi lapangan: menutup kegiatan adalah keputusan,
 * bukan pekerjaan mengetik. Menyelipkan penyuntingan kalimat di detik terakhir
 * membuat orang menekan "Finalkan" lalu malah disodori pekerjaan baru.
 *
 * Yang tersisa: satu konfirmasi, karena final tidak bisa dibatalkan.
 */
export function FinalizePanel({ activityId }: { activityId: string }) {
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [state, action, pending] = useAksi<FieldActivityState>(finalizeActivityAction, undefined);

  if (!konfirmasi) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" size="sm" variant="secondary" onClick={() => setKonfirmasi(true)}>
          <CheckCircle2 aria-hidden className="size-3.5" />
          Finalkan
        </Button>
        {state?.error ? <span className="text-xs text-danger-700">{state.error}</span> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
      <p className="text-[13px] text-ink">
        Finalkan kegiatan ini? Setelah final isinya tidak bisa diubah lagi – rapikan teksnya lewat
        tombol Edit dulu bila masih perlu.
      </p>
      {state?.error ? <p className="text-xs text-danger-700">{state.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="activityId" value={activityId} />
          <Button type="submit" size="sm" loading={pending}>
            Ya, finalkan
          </Button>
        </form>
        <Button type="button" size="sm" variant="ghost" onClick={() => setKonfirmasi(false)}>
          Batal
        </Button>
      </div>
    </div>
  );
}
