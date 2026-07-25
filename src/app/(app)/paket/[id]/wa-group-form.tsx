"use client";

import { useActionState, useState, useTransition } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { listWaGroupsAction, setPackageWaGroupAction, type WaActionState } from "@/lib/waha/actions";

type WahaGroup = { id: string; name: string };

/**
 * Atur grup WhatsApp tujuan sebuah paket. Dua cara mengisi:
 * 1) Pilih dari daftar grup (ditarik dari WAHA) — butuh sesi WA login.
 * 2) Tempel ID grup manual (…@g.us) sebagai cadangan.
 * Semua lokasi paket ini mengirim ke grup yang sama.
 */
export function WaGroupForm({
  packageId,
  currentGroupId,
  currentGroupName,
  wahaConfigured,
}: {
  packageId: string;
  currentGroupId: string | null;
  currentGroupName: string | null;
  wahaConfigured: boolean;
}) {
  const [state, action, pending] = useActionState<WaActionState, FormData>(setPackageWaGroupAction, undefined);
  const [groupId, setGroupId] = useState(currentGroupId ?? "");
  const [groupName, setGroupName] = useState(currentGroupName ?? "");
  const [groups, setGroups] = useState<WahaGroup[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();

  const loadGroups = () => {
    setLoadErr(null);
    startLoad(async () => {
      const res = await listWaGroupsAction();
      if (res.ok) setGroups(res.groups);
      else setLoadErr(res.error);
    });
  };

  const pick = (g: WahaGroup) => {
    setGroupId(g.id);
    setGroupName(g.name);
  };

  if (!wahaConfigured) {
    return (
      <Banner
        tone="info"
        title="Integrasi WhatsApp belum aktif"
        description="Admin perlu mengonfigurasi server WAHA (WAHA_BASE_URL & WAHA_API_KEY) dan login sesi WhatsApp. Lihat panduan di docs/WAHA_SETUP.md."
      />
    );
  }

  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="packageId" value={packageId} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={loadGroups} loading={loading}>
          <RefreshCw aria-hidden className="size-3.5" />
          {groups ? "Muat ulang daftar grup" : "Muat daftar grup dari WhatsApp"}
        </Button>
        {currentGroupId ? (
          <span className="inline-flex items-center gap-1 text-[13px] text-success">
            <MessageCircle aria-hidden className="size-3.5" />
            Terhubung: {currentGroupName || currentGroupId}
          </span>
        ) : (
          <span className="text-[13px] text-ink-muted">Belum ada grup.</span>
        )}
      </div>

      {loadErr ? <Banner tone="warning" title={loadErr} /> : null}

      {groups ? (
        groups.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Tidak ada grup ditemukan pada akun WhatsApp ini.</p>
        ) : (
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="pickGroup"
                  checked={groupId === g.id}
                  onChange={() => pick(g)}
                  className="border-border"
                />
                <span className="min-w-0">
                  {g.name}
                  <span className="block text-xs text-ink-faint">{g.id}</span>
                </span>
              </label>
            ))}
          </div>
        )
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="wa-group-id">ID grup (…@g.us)</Label>
          <Input
            id="wa-group-id"
            name="waGroupId"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            placeholder="mis. 120363000000000000@g.us"
          />
        </div>
        <div>
          <Label htmlFor="wa-group-name">Nama grup (untuk tampilan)</Label>
          <Input
            id="wa-group-name"
            name="waGroupName"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="mis. KNMP Pemalang – Progres"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>Simpan grup</Button>
        {currentGroupId ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setGroupId("");
              setGroupName("");
            }}
          >
            Kosongkan (lepas grup)
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-ink-muted">
        Tempel ID grup manual atau pilih dari daftar. ID grup diakhiri <code>@g.us</code>. Semua
        laporan/kegiatan lokasi di paket ini dikirim ke grup ini.
      </p>
    </form>
  );
}
