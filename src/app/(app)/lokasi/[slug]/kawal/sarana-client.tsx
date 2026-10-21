"use client";

import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Combobox } from "@/components/ui";
import type { ComboOption } from "@/components/ui/combobox";
import { petaSaranaKawalAction, type KawalAksiState } from "@/lib/kawal/peta-actions";

/**
 * Pasangkan satu sarana Kawal dengan kelompok RAB MARLIN, tandai tidak ada
 * padanannya, atau hapus keputusan supaya kembali ke usulan (DECISIONS 694).
 */
export function FormSarana({
  locationId,
  kawalItemId,
  opsi,
  awal,
  sudahDiputuskan,
  nama,
}: {
  locationId: string;
  kawalItemId: number;
  opsi: ComboOption[];
  awal?: string;
  sudahDiputuskan: boolean;
  nama: string;
}) {
  const [state, aksi, sibuk] = useAksi<KawalAksiState>(petaSaranaKawalAction, undefined);
  return (
    <form action={aksi} className="space-y-2">
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="kawalItemId" value={kawalItemId} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <Combobox
            name="lineageKey"
            options={opsi}
            defaultValue={awal}
            placeholder="Pilih kelompok RAB…"
            searchThreshold={0}
          />
        </div>
        <Button
          type="submit"
          name="aksi"
          value="pasangkan"
          variant="primary"
          loading={sibuk}
          aria-label={`Pasangkan ${nama}`}
        >
          Pasangkan
        </Button>
        <Button type="submit" name="aksi" value="tidak_ada" variant="secondary" loading={sibuk}>
          Tidak ada padanan
        </Button>
        {sudahDiputuskan ? (
          <Button type="submit" name="aksi" value="kembalikan" variant="secondary" loading={sibuk}>
            Kembali ke usulan
          </Button>
        ) : null}
      </div>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
    </form>
  );
}
