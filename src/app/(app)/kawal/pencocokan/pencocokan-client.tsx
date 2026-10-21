"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Combobox, Input, Label } from "@/components/ui";
import type { ComboOption } from "@/components/ui/combobox";
import {
  ambangKawalAction,
  petaKawalAction,
  sinkronKawalAction,
  type KawalAksiState,
} from "@/lib/kawal/peta-actions";

/**
 * Pesan hasil di tingkat HALAMAN. Baris yang baru dipasangkan langsung pindah
 * dari antrean ke daftar berpasangan – form-nya ikut lenyap, dan pesan sukses
 * yang ditaruh di dalam form lenyap bersamanya sebelum sempat terbaca.
 */
const LaporHasil = createContext<(s: KawalAksiState) => void>(() => {});

export function UmpanBalikKawal({ children }: { children: ReactNode }) {
  const [pesan, setPesan] = useState<KawalAksiState>(undefined);
  useEffect(() => {
    if (!pesan?.success) return;
    const t = setTimeout(() => setPesan(undefined), 8000);
    return () => clearTimeout(t);
  }, [pesan]);
  return (
    <LaporHasil.Provider value={setPesan}>
      {children}
      {pesan?.success ? (
        <div className="fixed inset-x-4 bottom-20 z-50 sm:right-6 sm:bottom-6 sm:left-auto sm:w-[26rem]">
          <Banner
            tone="success"
            title={pesan.success}
            action={
              <button
                type="button"
                onClick={() => setPesan(undefined)}
                aria-label="Tutup pesan"
                className="text-ink-muted hover:text-ink"
              >
                <X aria-hidden className="size-4" />
              </button>
            }
          />
        </div>
      ) : null}
    </LaporHasil.Provider>
  );
}

/** Aksi peta yang juga melapor ke tingkat halaman. Galat tetap tampil di form-nya. */
function useAksiPeta() {
  const lapor = useContext(LaporHasil);
  const aksi = useCallback(
    async (prev: KawalAksiState, data: FormData) => {
      const hasil = await petaKawalAction(prev, data);
      if (hasil?.success) lapor(hasil);
      return hasil;
    },
    [lapor],
  );
  return useAksi<KawalAksiState>(aksi, undefined);
}

export function TombolSinkron({ bisa }: { bisa: boolean }) {
  const [state, aksi, sibuk] = useAksi<KawalAksiState>(sinkronKawalAction, undefined);
  return (
    <form action={aksi} className="space-y-2">
      <Button type="submit" variant="primary" loading={sibuk} disabled={!bisa}>
        Sinkron sekarang
      </Button>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
    </form>
  );
}

/** Pilih lokasi MARLIN untuk satu baris Kawal, atau tandai bukan lokasi MARLIN. */
export function FormPasangkan({
  kawalId,
  opsi,
  awal,
  label,
}: {
  kawalId: number;
  opsi: ComboOption[];
  awal?: string;
  label: string;
}) {
  const [state, aksi, sibuk] = useAksiPeta();
  return (
    <form action={aksi} className="space-y-2">
      <input type="hidden" name="kawalId" value={kawalId} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-64 flex-1">
          <Combobox
            name="locationId"
            options={opsi}
            defaultValue={awal}
            placeholder="Pilih lokasi MARLIN…"
            searchThreshold={0}
          />
        </div>
        <Button type="submit" name="aksi" value="pasangkan" variant="primary" loading={sibuk} aria-label={label}>
          Pasangkan
        </Button>
        <Button type="submit" name="aksi" value="bukan_marlin" variant="secondary" loading={sibuk}>
          Bukan lokasi MARLIN
        </Button>
      </div>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
    </form>
  );
}

/** Ambang selisih tinggi/kritis (pp). Angka awal = yang berlaku sekarang. */
export function FormAmbang({ tinggiPp, kritisPp }: { tinggiPp: number; kritisPp: number }) {
  const [state, aksi, sibuk] = useAksi<KawalAksiState>(ambangKawalAction, undefined);
  const tulis = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  return (
    <form action={aksi} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <Label htmlFor="ambang-tinggi">Tinggi mulai (pp)</Label>
          <Input id="ambang-tinggi" name="tinggiPp" inputMode="decimal" defaultValue={tulis(tinggiPp)} required />
        </div>
        <div className="w-36">
          <Label htmlFor="ambang-kritis">Kritis mulai (pp)</Label>
          <Input id="ambang-kritis" name="kritisPp" inputMode="decimal" defaultValue={tulis(kritisPp)} required />
        </div>
        <Button type="submit" variant="secondary" loading={sibuk}>
          Simpan ambang
        </Button>
      </div>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
    </form>
  );
}

export function TombolKembalikan({ kawalId }: { kawalId: number }) {
  const [state, aksi, sibuk] = useAksiPeta();
  return (
    <form action={aksi} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="kawalId" value={kawalId} />
      <Button type="submit" name="aksi" value="kembalikan" variant="secondary" size="sm" loading={sibuk}>
        Kembalikan ke pencocokan
      </Button>
      {state?.error ? <span className="text-[13px] text-danger">{state.error}</span> : null}
    </form>
  );
}
