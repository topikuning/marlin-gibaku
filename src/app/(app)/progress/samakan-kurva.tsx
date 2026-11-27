"use client";

import { startTransition } from "react";
import { Banner, Button } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import { samakanKurvaSemuaLokasiAction, type SamakanKurvaState } from "./actions";

/**
 * Tombol "Samakan kurva-S semua lokasi dengan RAB aktif" (DECISIONS 797).
 * Hasilnya disebut per lokasi: yang disamakan beserta pekerjaan yang keluar
 * dan masuk, dan yang gagal beserta sebabnya. Yang sudah sesuai cukup dihitung.
 */
export function SamakanKurvaSemua() {
  const [state, kirim, pending] = useAksi<SamakanKurvaState>(
    (prev: SamakanKurvaState) => samakanKurvaSemuaLokasiAction(prev),
    undefined,
  );
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-muted">
        Memeriksa semua lokasi yang bisa Anda buka. Lokasi yang jadwal per pekerjaannya masih mengikuti RAB lama (misalnya
        pekerjaan yang sudah dinolkan CCO masih berbobot, atau pekerjaan baru belum berjadwal) disusun ulang dari RAB
        aktifnya. Titik kurva-S rencana tidak berubah, jadi rencana dan deviasi tetap. Lokasi yang sudah sesuai tidak
        disentuh.
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={pending}
        className="whitespace-normal"
        onClick={() => {
          if (!window.confirm("Periksa semua lokasi dan samakan kurva-S yang belum mengikuti RAB aktifnya?")) return;
          startTransition(() => kirim(new FormData()));
        }}
      >
        Samakan kurva-S semua lokasi dengan RAB aktif
      </Button>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {state?.disamakan && state.disamakan.length > 0 ? (
        <ul className="space-y-1.5 text-[13px] text-ink">
          {state.disamakan.map((d) => (
            <li key={d.nama}>
              <span className="font-medium">{d.nama}</span> – baseline #{d.baselineNo}
              {d.keluar.length > 0 ? `; dikeluarkan: ${d.keluar.join(", ")}` : ""}
              {d.masuk.length > 0 ? `; dijadwalkan otomatis: ${d.masuk.join(", ")}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {state?.gagal && state.gagal.length > 0 ? (
        <Banner
          tone="error"
          title="Lokasi yang gagal disamakan"
          description={state.gagal.map((g) => `${g.nama}: ${g.alasan}`).join(" · ")}
        />
      ) : null}
    </div>
  );
}
