"use client";

import { useId, useState } from "react";
import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Drawer, FileInput, HelpText, Input, Label } from "@/components/ui";
import { isiPenandatanganAction, type IsiPenandatanganState } from "./penandatangan-actions";

/**
 * Daftar slot penanda tangan yang KOSONG, masing-masing langsung bisa diisi
 * (DECISIONS 758). Permintaan user 2026-11-11: *"ini yang belum terisi
 * seharusnya tinggal klik yang mana, lalu masuk pilihan inputan nama dan
 * ttdnya"*.
 *
 * Tiap baris punya formulir dan status prosesnya sendiri. Sesudah tersimpan,
 * halaman disegarkan dan baris itu hilang dari daftar dengan sendirinya.
 */

export type SlotKosongView = { pihak: string; jabatan: string; dokumen: string[] };

export function DaftarSlotKosong({
  locationId,
  slots,
  bolehIsi,
  namaPaket,
}: {
  locationId: string;
  slots: SlotKosongView[];
  /** Pengguna punya `contract.manage`; tanpanya hanya daftar yang tampil. */
  bolehIsi: boolean;
  namaPaket: string;
}) {
  return (
    <ul className="space-y-1.5">
      {slots.map((k) => (
        <li key={k.pihak} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            <b className="font-medium text-ink">{k.jabatan}</b> – {k.dokumen.join(", ")}
          </span>
          {bolehIsi ? <IsiSlot locationId={locationId} slot={k} namaPaket={namaPaket} /> : null}
        </li>
      ))}
    </ul>
  );
}

function IsiSlot({ locationId, slot, namaPaket }: { locationId: string; slot: SlotKosongView; namaPaket: string }) {
  const [state, action, pending] = useAksi<IsiPenandatanganState>(isiPenandatanganAction, undefined);
  const id = useId();
  // Terkendali: React mengosongkan formulir sesudah aksi, juga yang GAGAL
  // (mis. unggahan ditolak) – nama yang sudah diketik jangan ikut hilang.
  const [nama, setNama] = useState("");
  return (
    <Drawer
      trigger={`Isi ${slot.jabatan}`}
      title={`Isi penanda tangan: ${slot.jabatan}`}
      subtitle={`Tercetak di ${slot.dokumen.join(", ")}. Berlaku untuk seluruh lokasi di paket ${namaPaket}. Kalau orang di lokasi ini berbeda, isi di halaman lokasi.`}
      // Panel ini hidup di dalam Banner – teksnya jangan ikut redup & kecil.
      className="text-sm text-ink"
    >
      <form action={action} className="space-y-4">
        {state?.error ? <Banner tone="error" title={state.error} /> : null}
        {state?.success ? <Banner tone="success" title={state.success} /> : null}
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="pihak" value={slot.pihak} />
        <div>
          <Label htmlFor={`${id}-nama`} required>
            Nama {slot.jabatan}
          </Label>
          <Input
            id={`${id}-nama`}
            name="nama"
            required
            minLength={2}
            maxLength={150}
            autoComplete="off"
            value={nama}
            onChange={(e) => setNama(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-ttd`}>Tanda tangan (boleh menyusul)</Label>
          <FileInput id={`${id}-ttd`} name="ttd" accept="image/png,image/jpeg,image/webp" maxBytes={2 * 1024 * 1024} />
          <HelpText>
            Foto atau pindai coretan tanda tangan di kertas putih polos. PNG/JPG/WebP maks 2 MB. Sampai gambarnya
            diunggah, dokumen memakai tanda tangan ketik dari nama di atas.
          </HelpText>
        </div>
        <Button type="submit" loading={pending}>
          Simpan
        </Button>
      </form>
    </Drawer>
  );
}
