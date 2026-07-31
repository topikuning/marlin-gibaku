"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { updateLocationMaster, type StatusActionState } from "./actions";

/**
 * Form master data lokasi (alamat administratif + koordinat) — hanya tampil
 * utk pemegang location.manage. Koordinat dipakai peta, cap foto, dan rule
 * GPS audit kualitas — perubahan tercatat di audit log. DECISIONS 134.
 */
export function LocationMasterForm({
  locationId,
  village,
  district,
  regency,
  province,
  gpsLat,
  gpsLng,
}: {
  locationId: string;
  village: string;
  district: string | null;
  regency: string;
  province: string;
  gpsLat: string | null;
  gpsLng: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, saving] = useActionState<StatusActionState, FormData>(updateLocationMaster, undefined);

  const adaKoordinat = !!(gpsLat && gpsLng);

  if (!open) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 text-sm">
            <p className="text-ink-muted">
              {village}
              {district ? `, ${district}` : ""}, {regency}, {province}
            </p>
            <p className="mt-0.5">
              <span className="text-ink-muted">Koordinat: </span>
              {adaKoordinat ? (
                <span className="tabular text-ink">
                  {gpsLat}, {gpsLng}
                </span>
              ) : (
                <span className="text-warning">belum diisi</span>
              )}
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Pencil aria-hidden className="size-3.5" />
            Ubah alamat &amp; koordinat
          </Button>
        </div>
        {!adaKoordinat ? (
          <Banner
            tone="warning"
            title="Lokasi ini belum punya koordinat"
            description="Selama kosong: tidak muncul di Peta, cuaca otomatis tidak jalan, dan cap foto memakai titik perangkat tanpa pembanding proyek."
          />
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
      <input type="hidden" name="locationId" value={locationId} />
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="lm-village">Desa/Kelurahan</Label>
          <Input id="lm-village" name="village" defaultValue={village} />
        </div>
        <div>
          <Label htmlFor="lm-district">Kecamatan</Label>
          <Input id="lm-district" name="district" defaultValue={district ?? ""} />
        </div>
        <div>
          <Label htmlFor="lm-regency">Kabupaten/Kota</Label>
          <Input id="lm-regency" name="regency" defaultValue={regency} />
        </div>
        <div>
          <Label htmlFor="lm-province">Provinsi</Label>
          <Input id="lm-province" name="province" defaultValue={province} />
        </div>
        <div>
          <Label htmlFor="lm-lat">Latitude</Label>
          <Input id="lm-lat" name="gpsLat" defaultValue={gpsLat ?? ""} placeholder="-6.8710100" inputMode="decimal" />
        </div>
        <div>
          <Label htmlFor="lm-lng">Longitude</Label>
          <Input id="lm-lng" name="gpsLng" defaultValue={gpsLng ?? ""} placeholder="109.2531230" inputMode="decimal" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={saving}>
          Simpan
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Tutup
        </Button>
        <span className="text-xs text-ink-faint">Salin koordinat dari Google Maps (klik kanan titik → salin).</span>
      </div>
    </form>
  );
}
