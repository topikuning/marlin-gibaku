"use client";

import { useActionState, useState, useTransition } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { Banner, Button, Input, Label } from "@/components/ui";
import {
  listWaGroupsAction,
  resolveWaInviteAction,
  setPackageWaGroupAction,
  type WaActionState,
} from "@/lib/waha/actions";

type WahaGroup = { id: string; name: string };

/**
 * Atur grup WhatsApp tujuan sebuah paket. Dua cara mengisi:
 * 1) Pilih dari daftar grup (ditarik dari WAHA) — butuh sesi WA login (WORKING).
 * 2) Tempel ID grup manual (…@g.us) — SELALU tersedia, tak butuh sesi login.
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

  const [invite, setInvite] = useState("");
  const [inviteMsg, setInviteMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [resolving, startResolve] = useTransition();

  const loadGroups = () => {
    setLoadErr(null);
    startLoad(async () => {
      const res = await listWaGroupsAction();
      if (res.ok) setGroups(res.groups);
      else setLoadErr(res.error);
    });
  };

  const resolveInvite = () => {
    setInviteMsg(null);
    startResolve(async () => {
      const res = await resolveWaInviteAction(invite);
      if (res.ok) {
        setGroupId(res.id);
        if (res.name) setGroupName(res.name);
        setInviteMsg({ tone: "success", text: `ID grup ditemukan: ${res.id}. Klik "Simpan grup" untuk menyimpan.` });
      } else {
        setInviteMsg({ tone: "error", text: res.error });
      }
    });
  };

  const pick = (g: WahaGroup) => {
    setGroupId(g.id);
    setGroupName(g.name);
  };

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="packageId" value={packageId} />

      {/* Status grup saat ini */}
      <div className="text-[13px]">
        {currentGroupId ? (
          <span className="inline-flex items-center gap-1 text-success">
            <MessageCircle aria-hidden className="size-3.5" />
            Grup terpasang: {currentGroupName || currentGroupId}
          </span>
        ) : (
          <span className="text-ink-muted">Paket ini belum punya grup WhatsApp.</span>
        )}
      </div>

      {!wahaConfigured ? (
        <Banner
          tone="info"
          title="Server WhatsApp (WAHA) belum diatur"
          description="Kamu tetap bisa menyimpan ID grup manual di bawah, tapi pesan baru bisa terkirim setelah admin mengatur WAHA di halaman Sistem & login sesi WhatsApp."
        />
      ) : null}

      {/* Cara 1: pilih dari daftar (butuh sesi WORKING) */}
      <div className="rounded-md border border-border p-3">
        <p className="mb-2 text-[13px] font-medium text-ink">Cara 1 — pilih dari daftar grup</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={loadGroups}
          loading={loading}
          disabled={!wahaConfigured}
        >
          <RefreshCw aria-hidden className="size-3.5" />
          {groups ? "Muat ulang daftar grup" : "Muat daftar grup dari WhatsApp"}
        </Button>

        {loadErr ? (
          <Banner
            tone="warning"
            title="Belum bisa memuat daftar grup"
            description={`${loadErr} — sementara itu, pakai Cara 2 (isi ID grup manual) di bawah.`}
            className="mt-2"
          />
        ) : null}

        {groups ? (
          groups.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-muted">
              Tidak ada grup ditemukan pada akun WhatsApp ini. Pastikan nomor pengirim sudah menjadi
              anggota grup, atau isi ID grup manual di bawah.
            </p>
          ) : (
            <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
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
      </div>

      {/* Cara 2: link undangan → resolve ID otomatis (tak butuh store NOWEB) */}
      <div className="rounded-md border border-border p-3">
        <p className="mb-1 text-[13px] font-medium text-ink">Cara 2 — pakai link undangan grup (disarankan)</p>
        <p className="mb-2 text-xs text-ink-muted">
          Di WhatsApp: buka grup → <b>Info grup</b> → <b>Tautan undangan grup</b> → Salin. Tempel di sini,
          sistem ambil ID grup otomatis. Pastikan nomor pengirim jadi anggota grup.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="wa-invite">Link undangan grup</Label>
            <Input
              id="wa-invite"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="https://chat.whatsapp.com/XXXXXXXXXXXX"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={resolveInvite}
            loading={resolving}
            disabled={!wahaConfigured || !invite.trim()}
          >
            Ambil ID dari link
          </Button>
        </div>
        {inviteMsg ? <Banner tone={inviteMsg.tone} title={inviteMsg.text} className="mt-2" /> : null}
      </div>

      {/* Cara 3: isi manual (selalu tersedia) */}
      <div className="rounded-md border border-border p-3">
        <p className="mb-2 text-[13px] font-medium text-ink">Cara 3 — isi ID grup manual</p>
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
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-primary hover:underline">
            Bagaimana cara mendapat ID grup?
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
            <li>Cara termudah: klik <b>Muat daftar grup</b> di atas (butuh sesi WhatsApp sudah login/WORKING).</li>
            <li>Atau buka dashboard WAHA → endpoint <code>GET /api/&#123;session&#125;/groups</code> → salin nilai <code>id</code> yang berakhiran <code>@g.us</code>.</li>
            <li>ID grup berbentuk angka panjang diakhiri <code>@g.us</code> (bukan nomor HP). Boleh tempel angkanya saja — sistem menambah <code>@g.us</code> otomatis.</li>
          </ul>
        </details>
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
        Semua laporan/kegiatan lokasi di paket ini dikirim ke grup ini.
      </p>
    </form>
  );
}
