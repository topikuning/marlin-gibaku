"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Banner, Button, Input, Label } from "@/components/ui";
import type { CatalogItem } from "@/lib/master-location/queries";
import {
  addTargetLocation,
  addTargetLocationsFromCatalog,
  removeTargetLocation,
  type PackageActionState,
} from "@/lib/package/actions";

/**
 * Pilih lokasi target dari KATALOG master (impor) — alur normal. Cari + centang
 * beberapa lalu tambahkan sekaligus. Manual tetap tersedia (AddLocationForm).
 */
export function CatalogLocationPicker({
  packageId,
  catalog,
}: {
  packageId: string;
  catalog: CatalogItem[];
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [state, setState] = useState<PackageActionState>(undefined);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return catalog;
    return catalog.filter((c) =>
      `${c.village} ${c.regency} ${c.province} ${c.district ?? ""} ${c.candidateVendor ?? ""}`
        .toLowerCase()
        .includes(s),
    );
  }, [q, catalog]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = () => {
    if (selected.length === 0) return;
    start(async () => {
      const r = await addTargetLocationsFromCatalog(packageId, selected);
      setState(r);
      if (r?.success) setSelected([]);
    });
  };

  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Cari desa/kabupaten/vendor… (${catalog.length} tersedia)`}
      />

      <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-muted">Tidak ada yang cocok.</p>
        ) : (
          filtered.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-surface-muted">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() => toggle(c.id)}
                className="mt-0.5 size-4 accent-(--color-primary)"
              />
              <span className="min-w-0 text-sm">
                <span className="font-medium text-ink">{c.village}</span>
                <span className="text-ink-muted">
                  {" "}
                  · {[c.district, c.regency, c.province].filter(Boolean).join(", ")}
                </span>
                {c.candidateVendor ? (
                  <span className="block text-[12px] text-ink-faint">Calon penyedia: {c.candidateVendor}</span>
                ) : null}
              </span>
            </label>
          ))
        )}
      </div>

      <Button type="button" onClick={submit} loading={pending} disabled={selected.length === 0}>
        Tambah {selected.length > 0 ? `${selected.length} ` : ""}lokasi terpilih
      </Button>
    </div>
  );
}

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
          <Label htmlFor="lk-district">Kecamatan</Label>
          <Input id="lk-district" name="district" placeholder="mis. Wedung" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lk-regency" required>
            Kabupaten/Kota
          </Label>
          <Input id="lk-regency" name="regency" required />
        </div>
        <div>
          <Label htmlFor="lk-province" required>
            Provinsi
          </Label>
          <Input id="lk-province" name="province" required defaultValue={defaultProvince} />
        </div>
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
