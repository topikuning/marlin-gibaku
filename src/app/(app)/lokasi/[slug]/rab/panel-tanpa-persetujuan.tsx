"use client";

import { useState } from "react";
import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Input } from "@/components/ui";
import { konfirmasiTanpaPersetujuan } from "@/lib/rab/persetujuan-aturan";
import { activateDraftAction, type RabActionState } from "./actions";

/**
 * Aktifkan draft TANPA dua persetujuan – hanya ditampilkan untuk super admin
 * UTAMA (DECISIONS 682). Pemanggil yang memutuskan kapan panel ini muncul;
 * aksinya tetap memeriksa ulang di server.
 */
export function PanelTanpaPersetujuan({
  revisionId,
  revisionNo,
  kurang,
  onBatal,
  onBerhasil,
}: {
  revisionId: string;
  revisionNo: number;
  /** Persetujuan yang belum ada – disebut supaya jelas apa yang dilewati. */
  kurang: string[];
  onBatal: () => void;
  onBerhasil?: (pesan: string) => void;
}) {
  const [ketik, setKetik] = useState("");
  const [state, action, pending] = useAksi<RabActionState>(async (prev: RabActionState, fd: FormData) => {
    const r = await activateDraftAction(prev, fd);
    if (r?.success) onBerhasil?.(r.success);
    return r;
  }, undefined);
  const wajib = konfirmasiTanpaPersetujuan(revisionNo);
  return (
    <div className="ml-auto max-w-md space-y-2 rounded-md border border-warning-border bg-warning-soft p-3 text-left text-[13px]">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <p className="font-semibold text-ink">Aktifkan revisi #{revisionNo} tanpa menunggu persetujuan</p>
      <p className="text-ink">
        Pilihan ini hanya untuk super admin utama. RAB aktif sekarang langsung digantikan. Kurva-S tidak diubah.
        {kurang.length > 0 ? ` Yang dilewati: ${kurang.join(" + ")}.` : ""} Tindakan ini tercatat di jejak audit atas
        nama Anda.
      </p>
      <form action={action} className="space-y-2">
        <input type="hidden" name="revisionId" value={revisionId} />
        <input type="hidden" name="tanpaPersetujuan" value="1" />
        <label className="block text-ink" htmlFor={`tanpa-ttd-${revisionId}`}>
          Ketik <span className="font-semibold">{wajib}</span> untuk konfirmasi
        </label>
        <Input
          id={`tanpa-ttd-${revisionId}`}
          name="konfirmasi"
          autoComplete="off"
          value={ketik}
          onChange={(e) => setKetik(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            variant="danger"
            loading={pending}
            disabled={ketik.trim().toUpperCase() !== wajib}
          >
            Aktifkan revisi #{revisionNo}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onBatal}>
            Batal
          </Button>
        </div>
      </form>
    </div>
  );
}
