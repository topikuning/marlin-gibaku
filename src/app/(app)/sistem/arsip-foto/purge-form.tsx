"use client";

import { useAksi } from "@/lib/aksi-klien";


import { Banner, Button, Combobox, Input, Label } from "@/components/ui";
import { purgeOriginalsAction, type RestampState } from "@/lib/photo-restamp/actions";

/**
 * Penghapusan arsip berkas asli — BERONGSOKAN BERFILTER (DECISIONS 198).
 *
 * Tidak ada penghapusan otomatis di sistem ini: arsip asli adalah satu-satunya
 * jalan memperbaiki cap, jadi hilangnya harus selalu tindakan sadar. Karena itu
 * kotak konfirmasi meminta mengetik HAPUS, bukan sekadar klik.
 */
export function PurgeForm({
  packages,
  locations,
}: {
  packages: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}) {
  const [state, action, pending] = useAksi<RestampState>(purgeOriginalsAction, undefined);
  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.ok ? <Banner tone="success" title={state.ok} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="pf-paket">Paket</Label>
          <Combobox id="pf-paket" name="packageId" defaultValue="">
            <option value="">– semua paket –</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Combobox>
        </div>
        <div>
          <Label htmlFor="pf-lokasi">Lokasi</Label>
          <Combobox id="pf-lokasi" name="locationId" defaultValue="">
            <option value="">– semua lokasi –</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Combobox>
        </div>
        <div>
          <Label htmlFor="pf-dari">Diunggah dari</Label>
          <Input id="pf-dari" name="dariTanggal" type="date" />
        </div>
        <div>
          <Label htmlFor="pf-sampai">Sampai</Label>
          <Input id="pf-sampai" name="sampaiTanggal" type="date" />
        </div>
      </div>

      <Banner
        tone="warning"
        title="Setelah dihapus, cap foto-foto itu TIDAK bisa diperbaiki lagi"
        description="Foto ber-capnya tetap ada dan tetap tampil seperti biasa – yang hilang adalah kemampuan mengulang capnya bila ternyata salah."
      />

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="pf-konfirmasi">Ketik HAPUS untuk mengonfirmasi</Label>
          <Input id="pf-konfirmasi" name="konfirmasi" placeholder="HAPUS" className="w-40" required />
        </div>
        <Button type="submit" variant="danger" loading={pending}>
          Hapus arsip asli terpilih
        </Button>
      </div>
    </form>
  );
}
