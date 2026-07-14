"use client";

import { useActionState } from "react";
import { Banner, Button, HelpText, Input, Label, Textarea } from "@/components/ui";
import { updatePackage, type PackageActionState } from "@/lib/package/actions";

export type TenderFormDefaults = {
  name: string;
  packageNumber: string;
  province: string;
  /** BigInt string dari server. */
  hpsValue: string;
  candidateVendorName: string;
  note: string;
};

export function TenderForm({
  packageId,
  defaults,
}: {
  packageId: string;
  defaults: TenderFormDefaults;
}) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    updatePackage,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="packageId" value={packageId} />

      <div>
        <Label htmlFor="tf-name" required>
          Nama paket
        </Label>
        <Input id="tf-name" name="name" required minLength={3} defaultValue={defaults.name} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="tf-number">Nomor paket</Label>
          <Input id="tf-number" name="packageNumber" defaultValue={defaults.packageNumber} />
        </div>
        <div>
          <Label htmlFor="tf-province">Provinsi</Label>
          <Input id="tf-province" name="province" defaultValue={defaults.province} />
        </div>
      </div>

      <div>
        <Label htmlFor="tf-hps" required>
          Nilai HPS (Rp)
        </Label>
        <Input
          id="tf-hps"
          name="hpsValue"
          required
          inputMode="numeric"
          defaultValue={defaults.hpsValue}
        />
        <HelpText>Angka rupiah tanpa desimal — pemisah titik boleh.</HelpText>
      </div>

      <div>
        <Label htmlFor="tf-vendor">Kandidat vendor</Label>
        <Input
          id="tf-vendor"
          name="candidateVendorName"
          defaultValue={defaults.candidateVendorName}
          placeholder="Nama kandidat pemenang"
        />
      </div>

      <div>
        <Label htmlFor="tf-note">Catatan</Label>
        <Textarea id="tf-note" name="note" defaultValue={defaults.note} />
      </div>

      <Button type="submit" loading={pending}>
        Simpan Perubahan
      </Button>
    </form>
  );
}
