"use client";

import { useActionState } from "react";
import { Banner, Button, Input, Label } from "@/components/ui";
import {
  addTargetLocation,
  removeTargetLocation,
  type PackageActionState,
} from "@/lib/package/actions";

/** Form tambah lokasi target (pra-kontrak). */
export function AddLocationForm({
  packageId,
  defaultProvince,
}: {
  packageId: string;
  defaultProvince: string;
}) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    addTargetLocation,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="packageId" value={packageId} />

      <div>
        <Label htmlFor="lk-name" required>
          Nama lokasi
        </Label>
        <Input id="lk-name" name="name" required minLength={3} placeholder="mis. KNMP Desa ..." />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lk-village" required>
            Desa/Kelurahan
          </Label>
          <Input id="lk-village" name="village" required />
        </div>
        <div>
          <Label htmlFor="lk-regency" required>
            Kabupaten/Kota
          </Label>
          <Input id="lk-regency" name="regency" required />
        </div>
      </div>

      <div>
        <Label htmlFor="lk-province" required>
          Provinsi
        </Label>
        <Input id="lk-province" name="province" required defaultValue={defaultProvince} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lk-lat">GPS Latitude</Label>
          <Input id="lk-lat" name="gpsLat" type="number" step="any" placeholder="-3.6543210" />
        </div>
        <div>
          <Label htmlFor="lk-lng">GPS Longitude</Label>
          <Input id="lk-lng" name="gpsLng" type="number" step="any" placeholder="128.1234567" />
        </div>
      </div>

      <Button type="submit" loading={pending}>
        Tambah Lokasi
      </Button>
    </form>
  );
}

/** Hapus lokasi target nonaktif (tanpa RAB/riwayat). */
export function RemoveLocationButton({
  locationId,
  name,
}: {
  locationId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(
    async () => removeTargetLocation(locationId),
    undefined,
  );

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Hapus lokasi target "${name}"?`)) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      {state?.error ? <span className="text-xs text-danger">{state.error}</span> : null}
      <Button type="submit" size="sm" variant="ghost" loading={pending}>
        Hapus
      </Button>
    </form>
  );
}
