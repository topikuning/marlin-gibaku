"use client";

import { useState } from "react";
import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Input } from "@/components/ui";
import { konfirmasiKoreksi, konfirmasiTanpaPersetujuan } from "@/lib/rab/persetujuan-aturan";
import { activateDraftAction, type RabActionState } from "./actions";

/** Dua jalan pintas super admin utama atas draft (DECISIONS 682/728). */
export type CaraTanpaPersetujuan = "aktifkan" | "koreksi";

/**
 * Draft TANPA dua persetujuan – hanya ditampilkan untuk super admin UTAMA.
 * `aktifkan` = draft berlaku sebagai adendum (MC-0/CCO); `koreksi` = isinya
 * menimpa RAB aktif di tempat. Pemanggil yang memutuskan kapan panel ini
 * muncul; aksinya tetap memeriksa ulang di server.
 */
export function PanelTanpaPersetujuan({
  cara,
  revisionId,
  revisionNo,
  kurang,
  onBatal,
  onBerhasil,
}: {
  cara: CaraTanpaPersetujuan;
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
  const koreksi = cara === "koreksi";
  const wajib = koreksi ? konfirmasiKoreksi(revisionNo) : konfirmasiTanpaPersetujuan(revisionNo);
  return (
    <div className="ml-auto max-w-md space-y-2 rounded-md border border-warning-border bg-warning-soft p-3 text-left text-[13px]">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <p className="font-semibold text-ink">
        {koreksi
          ? `Terapkan draft #${revisionNo} sebagai koreksi RAB aktif`
          : `Aktifkan draft #${revisionNo} sebagai adendum tanpa menunggu persetujuan`}
      </p>
      <p className="text-ink">
        Pilihan ini hanya untuk super admin utama.{" "}
        {koreksi
          ? "Isi RAB aktif ditimpa dengan isi draft ini, lalu draftnya habis terpakai. Tidak ada revisi baru dan tidak dihitung sebagai MC-0/CCO. Laporan harian yang diinput terhadap draft ikut menjadi resmi."
          : "Draft ini langsung berlaku sebagai perubahan kontrak (MC-0/CCO) dan menggantikan RAB aktif. Kurva-S tidak diubah."}
        {kurang.length > 0 ? ` Yang dilewati: ${kurang.join(" + ")}.` : ""} Tindakan ini tercatat di jejak audit atas
        nama Anda.
      </p>
      <form action={action} className="space-y-2">
        <input type="hidden" name="revisionId" value={revisionId} />
        <input type="hidden" name="tanpaPersetujuan" value="1" />
        <input type="hidden" name="cara" value={cara} />
        <label className="block text-ink" htmlFor={`tanpa-ttd-${cara}-${revisionId}`}>
          Ketik <span className="font-semibold">{wajib}</span> untuk konfirmasi
        </label>
        <Input
          id={`tanpa-ttd-${cara}-${revisionId}`}
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
            disabled={ketik.trim().replace(/\s+/g, " ").toUpperCase() !== wajib}
          >
            {koreksi ? "Terapkan sebagai koreksi" : `Aktifkan revisi #${revisionNo}`}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onBatal}>
            Batal
          </Button>
        </div>
      </form>
    </div>
  );
}
