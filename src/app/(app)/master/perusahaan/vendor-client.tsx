"use client";

import { useActionState, useMemo, useState } from "react";
import { GitMerge, Trash2, AlertTriangle, Pencil } from "lucide-react";
import { Banner, Button, Combobox, FileInput, Input, Label } from "@/components/ui";
import {
  deleteVendorAction,
  mergeVendorsAction,
  updateVendorAction,
  type VendorActionState,
} from "@/lib/vendor/actions";

type V = {
  id: string;
  name: string;
  npwp: string | null;
  contact: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  kopUrl: string | null;
  stempelUrl: string | null;
  contractCount: number;
  commitmentCount: number;
  normKey: string;
};

export function VendorManager({ vendors, duplicateKeys }: { vendors: V[]; duplicateKeys: string[] }) {
  const [filter, setFilter] = useState("");
  const dupSet = useMemo(() => new Set(duplicateKeys), [duplicateKeys]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? vendors.filter((v) => v.name.toLowerCase().includes(q)) : vendors;
  }, [vendors, filter]);

  return (
    <div className="space-y-3">
      {duplicateKeys.length > 0 ? (
        <Banner
          tone="warning"
          title={`${duplicateKeys.length} kemungkinan grup duplikat terdeteksi`}
          description="Baris bertanda ⚠ punya nama serupa (setelah abaikan CV./PT & tanda baca). Gabungkan ke satu vendor kanonik."
        />
      ) : null}

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Cari perusahaan…"
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm outline-none focus:border-border-strong"
      />

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-2">Perusahaan</th>
              <th className="px-3 py-2 text-right">Kontrak</th>
              <th className="px-3 py-2 text-right">Komitmen</th>
              <th className="px-3 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((v) => (
              <VendorRow key={v.id} vendor={v} all={vendors} flagged={dupSet.has(v.normKey)} />
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 ? <p className="text-sm text-ink-muted">Tidak ada perusahaan cocok.</p> : null}
    </div>
  );
}

function VendorRow({ vendor, all, flagged }: { vendor: V; all: V[]; flagged: boolean }) {
  const used = vendor.contractCount > 0 || vendor.commitmentCount > 0;
  const [mergeState, mergeAction, merging] = useActionState<VendorActionState, FormData>(mergeVendorsAction, undefined);
  const [delState, delAction, deleting] = useActionState<VendorActionState, FormData>(deleteVendorAction, undefined);
  const [target, setTarget] = useState("");
  const [editing, setEditing] = useState(false);
  const others = all.filter((v) => v.id !== vendor.id);
  const err = mergeState?.error ?? delState?.error;
  const targetName = others.find((o) => o.id === target)?.name ?? "";

  function confirmMerge(e: React.FormEvent) {
    const msg = `Gabungkan "${vendor.name}" ke "${targetName}"? ${vendor.contractCount} kontrak & ${vendor.commitmentCount} komitmen dialihkan, lalu "${vendor.name}" dihapus. Tidak bisa dibatalkan otomatis.`;
    if (typeof window !== "undefined" && !window.confirm(msg)) e.preventDefault();
  }

  return (
    <>
    <tr className="align-top">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2 font-medium text-ink">
          {vendor.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL presigned R2 sementara
            <img src={vendor.logoUrl} alt="" className="size-7 shrink-0 rounded border border-border object-contain" />
          ) : null}
          {flagged ? <AlertTriangle aria-hidden className="size-3.5 text-warning" /> : null}
          {vendor.name}
        </div>
        <div className="text-[11px] text-ink-faint">
          {[vendor.npwp ? `NPWP ${vendor.npwp}` : null, vendor.phone, vendor.email].filter(Boolean).join(" · ") || "profil belum lengkap"}
        </div>
        {err ? <div className="mt-1 text-[12px] text-danger">{err}</div> : null}
      </td>
      <td className="tabular px-3 py-2 text-right">{vendor.contractCount}</td>
      <td className="tabular px-3 py-2 text-right">{vendor.commitmentCount}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant={editing ? "primary" : "ghost"} onClick={() => setEditing((v) => !v)}>
            <Pencil aria-hidden className="size-3.5" />
            {editing ? "Tutup" : "Edit"}
          </Button>
          <form action={mergeAction} onSubmit={confirmMerge} className="flex items-center gap-1">
            <input type="hidden" name="fromId" value={vendor.id} />
            <input type="hidden" name="toId" value={target} />
            <Combobox
              aria-label="Gabung ke"
              value={target}
              onChange={(value) => setTarget(value)}
              className="h-8 w-44 text-[13px]"
            >
              <option value="">Gabung ke…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Combobox>
            <Button type="submit" size="sm" variant="secondary" loading={merging} disabled={!target}>
              <GitMerge aria-hidden className="size-3.5" />
              Gabung
            </Button>
          </form>
          {!used ? (
            <form action={delAction}>
              <input type="hidden" name="vendorId" value={vendor.id} />
              <Button type="submit" size="sm" variant="ghost" loading={deleting}>
                <Trash2 aria-hidden className="size-3.5" />
                Hapus
              </Button>
            </form>
          ) : null}
        </div>
      </td>
    </tr>
    {editing ? (
      <tr>
        <td colSpan={4} className="bg-surface-muted px-3 py-3">
          <VendorEditForm vendor={vendor} onDone={() => setEditing(false)} />
        </td>
      </tr>
    ) : null}
    </>
  );
}

/** Form master data perusahaan (profil kop surat + logo). */
function VendorEditForm({ vendor, onDone }: { vendor: V; onDone: () => void }) {
  const [state, action, saving] = useActionState<VendorActionState, FormData>(updateVendorAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={vendor.id} />
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor={`v-name-${vendor.id}`}>Nama perusahaan</Label>
          <Input id={`v-name-${vendor.id}`} name="name" defaultValue={vendor.name} />
        </div>
        <div>
          <Label htmlFor={`v-npwp-${vendor.id}`}>NPWP</Label>
          <Input id={`v-npwp-${vendor.id}`} name="npwp" defaultValue={vendor.npwp ?? ""} />
        </div>
        <div>
          <Label htmlFor={`v-contact-${vendor.id}`}>Narahubung</Label>
          <Input id={`v-contact-${vendor.id}`} name="contact" defaultValue={vendor.contact ?? ""} placeholder="nama PIC" />
        </div>
        <div>
          <Label htmlFor={`v-phone-${vendor.id}`}>Telepon</Label>
          <Input id={`v-phone-${vendor.id}`} name="phone" defaultValue={vendor.phone ?? ""} placeholder="0812…" />
        </div>
        <div>
          <Label htmlFor={`v-email-${vendor.id}`}>Email</Label>
          <Input id={`v-email-${vendor.id}`} name="email" type="email" defaultValue={vendor.email ?? ""} />
        </div>
        <div>
          <Label htmlFor={`v-logo-${vendor.id}`}>Logo (PNG/JPG/WebP ≤ 2 MB)</Label>
          <FileInput
            id={`v-logo-${vendor.id}`}
            name="logo"
            accept="image/png,image/jpeg,image/webp"
            maxBytes={2 * 1024 * 1024}
          />
        </div>
        <div>
          <Label htmlFor={`v-stempel-${vendor.id}`}>Stempel perusahaan (PNG/JPG/WebP ≤ 2 MB)</Label>
          {vendor.stempelUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL presigned R2 sementara
            <img
              src={vendor.stempelUrl}
              alt="Stempel perusahaan saat ini"
              className="mb-1.5 size-16 rounded border border-border bg-white object-contain"
            />
          ) : null}
          <FileInput
            id={`v-stempel-${vendor.id}`}
            name="stempel"
            accept="image/png,image/jpeg,image/webp"
            maxBytes={2 * 1024 * 1024}
          />
          <p className="mt-0.5 text-xs text-ink-faint">
            Dipakai di blok tanda tangan laporan harian, mingguan &amp; periodik yang dicetak. Pindai
            stempel di kertas putih polos; latar putihnya tidak akan menutupi tanda tangan.
          </p>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Label htmlFor={`v-addr-${vendor.id}`}>Alamat (untuk kop surat)</Label>
          <Input id={`v-addr-${vendor.id}`} name="address" defaultValue={vendor.address ?? ""} placeholder="Jl. … , Kab/Kota, Provinsi" />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Label htmlFor={`v-kop-${vendor.id}`}>Kop surat (gambar desain jadi — PNG/JPG/WebP ≤ 2 MB, lebar penuh)</Label>
          {vendor.kopUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL presigned R2 sementara
            <img src={vendor.kopUrl} alt="Kop surat saat ini" className="mb-1.5 max-h-28 w-full rounded border border-border bg-white object-contain object-left" />
          ) : null}
          <input
            id={`v-kop-${vendor.id}`}
            name="kop"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="block w-full text-sm text-ink-muted file:mr-2 file:rounded-md file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-sm"
          />
          <p className="mt-0.5 text-xs text-ink-faint">Unggah desain kop yang sudah jadi; penempatan otomatis di header laporan cetak menyusul.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={saving}>
          Simpan master data
        </Button>
        {vendor.logoUrl ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" name="removeLogo" value="1" /> Hapus logo
          </label>
        ) : null}
        {vendor.kopUrl ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" name="removeKop" value="1" /> Hapus kop
          </label>
        ) : null}
        {vendor.stempelUrl ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" name="removeStempel" value="1" /> Hapus stempel
          </label>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Tutup
        </Button>
        <span className="text-xs text-ink-faint">Logo & kop dipakai dokumen cetak (wiring penempatan menyusul).</span>
      </div>
    </form>
  );
}
