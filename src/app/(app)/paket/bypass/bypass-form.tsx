"use client";

import { useActionState, useMemo, useState } from "react";
import { Banner, Button, HelpText, Input, Label, Select } from "@/components/ui";
import { createDirectProject, type PackageActionState } from "@/lib/package/actions";

export type MasterLocationOption = {
  id: string;
  province: string;
  regency: string;
  district: string | null;
  village: string;
  candidateVendor: string | null;
};
export type VendorOption = { id: string; name: string };

export function BypassForm({
  masters,
  vendors,
  hiddenExistingCount = 0,
}: {
  masters: MasterLocationOption[];
  vendors: VendorOption[];
  hiddenExistingCount?: number;
}) {
  const [state, action, pending] = useActionState<PackageActionState, FormData>(createDirectProject, undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [newVendor, setNewVendor] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return masters;
    return masters.filter((m) =>
      [m.province, m.regency, m.district, m.village, m.candidateVendor]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(q)),
    );
  }, [masters, filter]);

  // Grup per provinsi utk keterbacaan.
  const groups = useMemo(() => {
    const map = new Map<string, MasterLocationOption[]>();
    for (const m of filtered) {
      const arr = map.get(m.province) ?? [];
      arr.push(m);
      map.set(m.province, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={action} className="space-y-5">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}

      {masters.length === 0 ? (
        <Banner
          tone="warning"
          title="Tidak ada lokasi katalog yang tersedia"
          description={
            hiddenExistingCount > 0
              ? `${hiddenExistingCount} lokasi katalog sudah ada sebagai lokasi di sistem, sisanya sudah terpakai. Tidak ada yang bisa dibuat lewat jalur cepat.`
              : "Belum ada lokasi master (semua sudah terpakai atau belum di-seed)."
          }
        />
      ) : null}

      {/* 1 · Paket */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">1 · Data paket</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="bp-name" required>Nama paket</Label>
            <Input id="bp-name" name="name" required minLength={3} maxLength={200} placeholder="mis. KNMP Jawa Tengah — Paket 1" />
          </div>
          <div>
            <Label htmlFor="bp-number">Nomor paket (opsional)</Label>
            <Input id="bp-number" name="packageNumber" maxLength={100} />
          </div>
        </div>
        <div>
          <Label htmlFor="bp-prov">Provinsi paket (opsional)</Label>
          <Input id="bp-prov" name="province" maxLength={100} placeholder="dikosongkan → ikut provinsi lokasi pertama" />
        </div>
      </fieldset>

      {/* 2 · Kontrak */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">2 · Kontrak</legend>
        <div>
          <Label htmlFor="bp-vendor" required>Vendor / penyedia</Label>
          {!newVendor ? (
            <>
              <Select id="bp-vendor" name="vendorId" defaultValue="" required={!newVendor}>
                <option value="" disabled>— pilih dari master —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </Select>
              <button type="button" className="mt-1 text-[13px] text-primary hover:underline" onClick={() => setNewVendor(true)}>
                + vendor baru (tidak ada di daftar)
              </button>
            </>
          ) : (
            <>
              <Input name="vendorName" required minLength={3} maxLength={200} placeholder="Nama vendor baru" />
              <button type="button" className="mt-1 text-[13px] text-primary hover:underline" onClick={() => setNewVendor(false)}>
                ← pilih dari master
              </button>
            </>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="bp-cnum" required>Nomor kontrak</Label>
            <Input id="bp-cnum" name="contractNumber" required minLength={3} maxLength={150} />
          </div>
          <div>
            <Label htmlFor="bp-cval" required>Nilai kontrak (Rp, inkl. PPN)</Label>
            <Input id="bp-cval" name="contractValue" inputMode="numeric" required placeholder="mis. 3400000000" />
          </div>
          <div>
            <Label htmlFor="bp-ppn">PPN (%)</Label>
            <Input id="bp-ppn" name="ppnPercent" type="number" min={0} max={100} step="0.1" defaultValue={11} />
          </div>
          <div>
            <Label htmlFor="bp-signed" required>Tanggal TTD kontrak</Label>
            <Input id="bp-signed" name="signedDate" type="date" required />
          </div>
          <div>
            <Label htmlFor="bp-dur" required>Masa pelaksanaan (hari)</Label>
            <Input id="bp-dur" name="durationDays" type="number" min={1} max={3650} required placeholder="mis. 150" />
          </div>
        </div>
        <HelpText>Tanggal mulai (SPMK) belum diisi di sini — tetap lewat langkah “Mulai Pelaksanaan”.</HelpText>
      </fieldset>

      {/* 3 · Lokasi dari katalog */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">
          3 · Lokasi dari katalog{" "}
          <span className="font-normal text-ink-muted">({selected.size} dipilih)</span>
        </legend>
        {hiddenExistingCount > 0 ? (
          <HelpText>
            {hiddenExistingCount} lokasi katalog disembunyikan karena sudah ada sebagai lokasi di sistem
            (mitigasi lokasi ganda).
          </HelpText>
        ) : null}
        {masters.length > 0 ? (
          <>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Cari provinsi / kabupaten / desa / vendor…"
              className="mb-1"
            />
            <div className="max-h-80 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {groups.map(([prov, items]) => (
                <div key={prov}>
                  <div className="sticky top-0 bg-surface-muted px-3 py-1 text-[12px] font-semibold text-ink-muted">
                    {prov} ({items.length})
                  </div>
                  {items.map((m) => (
                    <label key={m.id} className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-surface-muted">
                      <input
                        type="checkbox"
                        name="masterLocationIds"
                        value={m.id}
                        checked={selected.has(m.id)}
                        onChange={() => toggle(m.id)}
                        className="mt-0.5 size-4"
                      />
                      <span className="text-[13px]">
                        <span className="font-medium text-ink">{m.village}</span>
                        <span className="text-ink-muted"> — {m.regency}{m.district ? `, Kec. ${m.district}` : ""}</span>
                        {m.candidateVendor ? (
                          <span className="block text-[11px] text-ink-faint">calon: {m.candidateVendor}</span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
              {filtered.length === 0 ? <p className="px-3 py-3 text-[13px] text-ink-muted">Tak ada yang cocok.</p> : null}
            </div>
          </>
        ) : null}
      </fieldset>

      <Button type="submit" loading={pending} disabled={selected.size === 0 || masters.length === 0}>
        Buat proyek ({selected.size} lokasi)
      </Button>
    </form>
  );
}
