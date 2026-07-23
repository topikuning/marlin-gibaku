"use client";

import { useActionState, useMemo, useState } from "react";
import { GitMerge, Trash2, AlertTriangle } from "lucide-react";
import { Banner, Button, Select } from "@/components/ui";
import {
  deleteVendorAction,
  mergeVendorsAction,
  type VendorActionState,
} from "@/lib/vendor/actions";

type V = {
  id: string;
  name: string;
  npwp: string | null;
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
  const others = all.filter((v) => v.id !== vendor.id);
  const err = mergeState?.error ?? delState?.error;
  const targetName = others.find((o) => o.id === target)?.name ?? "";

  function confirmMerge(e: React.FormEvent) {
    const msg = `Gabungkan "${vendor.name}" ke "${targetName}"? ${vendor.contractCount} kontrak & ${vendor.commitmentCount} komitmen dialihkan, lalu "${vendor.name}" dihapus. Tidak bisa dibatalkan otomatis.`;
    if (typeof window !== "undefined" && !window.confirm(msg)) e.preventDefault();
  }

  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 font-medium text-ink">
          {flagged ? <AlertTriangle aria-hidden className="size-3.5 text-warning" /> : null}
          {vendor.name}
        </div>
        {vendor.npwp ? <div className="text-[11px] text-ink-faint">NPWP {vendor.npwp}</div> : null}
        {err ? <div className="mt-1 text-[12px] text-danger">{err}</div> : null}
      </td>
      <td className="tabular px-3 py-2 text-right">{vendor.contractCount}</td>
      <td className="tabular px-3 py-2 text-right">{vendor.commitmentCount}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <form action={mergeAction} onSubmit={confirmMerge} className="flex items-center gap-1">
            <input type="hidden" name="fromId" value={vendor.id} />
            <input type="hidden" name="toId" value={target} />
            <Select
              aria-label="Gabung ke"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-8 w-44 text-[13px]"
            >
              <option value="">Gabung ke…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
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
  );
}
