"use client";

import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Combobox, HelpText, Label } from "@/components/ui";
import { opsiModeMinggu } from "@/lib/periode-minggu";
import { ubahModeMingguBawaanAction, type ModeMingguBawaanState } from "@/lib/periode-minggu-actions";
import type { WeekPeriodMode } from "@/lib/progress-calc";

/** Periode minggu bawaan kontrak baru (DECISIONS 708). */
export function ModeMingguPanel({ bawaan }: { bawaan: WeekPeriodMode }) {
  const [state, aksi, sibuk] = useAksi<ModeMingguBawaanState>(ubahModeMingguBawaanAction, undefined);
  return (
    <form action={aksi} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.ok ? <Banner tone="success" title={state.ok} /> : null}
      <div className="max-w-md">
        <Label htmlFor="mm-bawaan">Periode minggu kontrak baru</Label>
        <Combobox id="mm-bawaan" name="weekMode" defaultValue={bawaan} options={opsiModeMinggu()} />
        <HelpText>
          Dipakai saat kontrak baru dibuat. Kontrak yang sudah ada tidak berubah; periodenya diganti per paket di
          halaman kontrak.
        </HelpText>
      </div>
      <Button type="submit" variant="primary" loading={sibuk}>
        Simpan
      </Button>
    </form>
  );
}
