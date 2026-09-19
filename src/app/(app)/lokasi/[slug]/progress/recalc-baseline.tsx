"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Banner, Button, Combobox, Label } from "@/components/ui";
import { PROFIL_KURVA_KETERANGAN, PROFIL_KURVA_LABEL } from "@/lib/scurve/profil";
import { recalcBaselineAction, type RabActionState } from "../rab/actions";

/**
 * Tombol "Hitung ulang kurva-S" — regenerate baseline dari RAB aktif.
 * Dua langkah (klik → konfirmasi) supaya tidak jalan karena salah klik.
 * Server idempotent: hasil identik → tidak dibuat versi baru.
 *
 * Tata letak "anti tumpang tindih": tombol selalu tetap di slot header; panel
 * konfirmasi + banner hasil (sukses/gagal) muncul sebagai popover `absolute`
 * (mengambang, z-30) di bawah-kanan tombol — TIDAK menambah tinggi/lebar header
 * sehingga tak pernah menekan judul kartu atau meluber ke kartu tetangga
 * ("Rencana vs realisasi").
 */
export function RecalcBaselineButton({
  locationId,
  profilAktif,
}: {
  locationId: string;
  /**
   * Profil baseline yang SEDANG berlaku = bawaan pemilih di bawah.
   *
   * Bukan `PROFIL_KURVA_DEFAULT`: memasang bawaan sistem di sini berarti lokasi
   * yang sudah sengaja memilih "optimalisasi pekerjaan" akan kembali ke "awal
   * lambat" pada ketukan berikutnya, tanpa seorang pun memintanya.
   */
  profilAktif: "lambat" | "optimal";
}) {
  const [state, action, pending] = useAksi<RabActionState>(
    recalcBaselineAction,
    undefined,
  );
  const [open, setOpen] = useState(false);
  const [profil, setProfil] = useState<"lambat" | "optimal">(profilAktif);

  return (
    <div className="relative">
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
        <RefreshCw aria-hidden className="size-3.5" />
        Hitung ulang
      </Button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface p-3 text-left shadow-lg">
          {state?.error ? <Banner tone="error" title={state.error} className="mb-2" /> : null}
          {state?.success ? <Banner tone="success" title={state.success} className="mb-2" /> : null}
          <p className="mb-2 text-[13px] text-ink">
            Hitung ulang kurva-S dari RAB &amp; durasi kontrak saat ini? Bila hasilnya
            berbeda, baseline aktif digantikan versi baru (versi lama tetap tersimpan
            di Riwayat baseline). Edit manual pada baseline aktif akan ditimpa.
          </p>
          {/* Di sinilah user berpindah lambat ⇄ optimal kapan pun, bukan cuma
              sekali sesudah impor. "Saya susun sendiri" tidak ditawarkan: tombol
              ini memang untuk MENGHITUNG – yang mau menyusun sendiri memakai
              editor jadwal atau impor jadwal Excel di atas. */}
          <div className="mb-2">
            <Label htmlFor="profil-kurva-hitung">Bentuk kurva</Label>
            <Combobox
              id="profil-kurva-hitung"
              value={profil}
              onChange={(v) => setProfil(v === "optimal" ? "optimal" : "lambat")}
              options={(["lambat", "optimal"] as const).map((p) => ({
                value: p,
                label: PROFIL_KURVA_LABEL[p],
              }))}
              disabled={pending}
            />
            <p className="mt-1 text-[11px] text-ink-muted">{PROFIL_KURVA_KETERANGAN[profil]}</p>
          </div>
          <form action={action} className="flex justify-end gap-2">
            <input type="hidden" name="locationId" value={locationId} />
            <input type="hidden" name="profil" value={profil} />
            <Button type="submit" size="sm" variant="secondary" loading={pending}>
              Ya, hitung ulang
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Tutup
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
