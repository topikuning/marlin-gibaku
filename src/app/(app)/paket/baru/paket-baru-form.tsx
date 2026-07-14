"use client";

import { useActionState } from "react";
import { Banner, Button, HelpText, Input, Label, Textarea } from "@/components/ui";
import { createPackage, type PackageActionState } from "@/lib/package/actions";

export function PaketBaruForm() {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    createPackage,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}

      <div>
        <Label htmlFor="pb-name" required>
          Nama paket
        </Label>
        <Input id="pb-name" name="name" required minLength={3} placeholder="Pembangunan KNMP ..." />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pb-number">Nomor paket</Label>
          <Input id="pb-number" name="packageNumber" placeholder="Opsional" />
        </div>
        <div>
          <Label htmlFor="pb-province">Provinsi</Label>
          <Input id="pb-province" name="province" placeholder="mis. Maluku" />
        </div>
      </div>

      <div>
        <Label htmlFor="pb-hps" required>
          Nilai HPS (Rp)
        </Label>
        <Input
          id="pb-hps"
          name="hpsValue"
          required
          inputMode="numeric"
          placeholder="mis. 12.500.000.000"
        />
        <HelpText>Angka rupiah — pemisah titik boleh, akan dibaca sebagai angka.</HelpText>
      </div>

      <div>
        <Label htmlFor="pb-vendor">Kandidat vendor</Label>
        <Input id="pb-vendor" name="candidateVendorName" placeholder="Opsional — nama kandidat" />
      </div>

      <div>
        <Label htmlFor="pb-note">Catatan</Label>
        <Textarea id="pb-note" name="note" placeholder="Opsional" />
      </div>

      <Button type="submit" loading={pending}>
        Buat Paket
      </Button>
    </form>
  );
}
