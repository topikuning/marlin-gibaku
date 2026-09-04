"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState, useTransition } from "react";
import { HardDriveUpload, Link2, Unplug } from "lucide-react";
import { Badge, Banner, Button, HelpText, Input, Label } from "@/components/ui";
import {
  disconnectGDriveAction,
  saveGDriveClientAction,
  testGDriveAction,
  type GDriveActionState,
} from "@/lib/gdrive/actions";

/**
 * Koneksi Google Drive (admin): OAuth app (client ID/secret) + hubungkan akun
 * Gmail yang jadi editor folder KKP. Refresh token disimpan terenkripsi.
 * DECISIONS 141.
 */
export function GDrivePanel({
  initial,
  redirectUri,
}: {
  initial: { clientId: string; hasClientSecret: boolean; connected: boolean; accountEmail: string | null };
  /** Redirect URI persis yang dikirim MARLIN; null = domain publik tak terdeteksi. */
  redirectUri: string | null;
}) {
  const [state, action, pending] = useAksi<GDriveActionState>(saveGDriveClientAction, undefined);
  const [opMsg, setOpMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, startOp] = useTransition();

  const runOp = (op: () => Promise<GDriveActionState>) => {
    setOpMsg(null);
    startOp(async () => {
      const r = await op();
      if (r?.error) setOpMsg({ tone: "error", text: r.error });
      else if (r?.success) setOpMsg({ tone: "success", text: r.success });
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {initial.connected ? (
          <>
            <Badge tone="success" label="Terhubung" />
            {initial.accountEmail ? <span className="text-sm text-ink-muted">{initial.accountEmail}</span> : null}
          </>
        ) : (
          <Badge tone="neutral" label="Belum terhubung" />
        )}
      </div>

      <form action={action} className="space-y-3">
        {state?.error ? <Banner tone="error" title={state.error} /> : null}
        {state?.success ? <Banner tone="success" title={state.success} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="gd-client-id">OAuth Client ID</Label>
            <Input id="gd-client-id" name="clientId" defaultValue={initial.clientId} placeholder="….apps.googleusercontent.com" />
          </div>
          <div>
            <Label htmlFor="gd-client-secret">OAuth Client Secret</Label>
            <Input
              id="gd-client-secret"
              name="clientSecret"
              type="password"
              placeholder={initial.hasClientSecret ? "•••••••• (tersimpan – isi untuk mengganti)" : "Client secret"}
            />
          </div>
        </div>
        {redirectUri ? (
          <div className="rounded-md border border-border bg-surface-inset p-2.5">
            <p className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
              Authorized redirect URI (salin ke Google Console)
            </p>
            <code className="mt-1 block break-all text-[13px] text-ink">{redirectUri}</code>
            <p className="mt-1.5 text-[12px] text-ink-muted">
              Harus PERSIS sama (termasuk https dan tanpa garis miring di akhir) di{" "}
              <span className="font-medium">Credentials → OAuth client → Authorized redirect URIs</span>.
            </p>
          </div>
        ) : (
          <Banner
            tone="warning"
            title="Domain publik tidak terdeteksi"
            description="Set environment variable APP_PUBLIC_URL (mis. https://marlin.up.railway.app) lalu redeploy. Tanpa itu MARLIN tidak tahu alamat publiknya sendiri dan OAuth Google akan ditolak."
          />
        )}
        <HelpText>
          Buat OAuth Client <span className="font-medium">tipe Web application</span> di Google Cloud Console.
          Aktifkan <span className="font-medium">Google Drive API</span>, dan di OAuth consent screen tambahkan
          scope <code className="rounded bg-surface-inset px-1">.../auth/drive</code> lalu klik{" "}
          <span className="font-medium">Publish app</span> (status In production) – status Testing membuat token
          mati tiap 7 hari.
        </HelpText>
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Simpan konfigurasi
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-t border-border-muted pt-3">
        <a
          href="/api/gdrive/auth"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-primary hover:bg-surface-muted"
        >
          <Link2 aria-hidden className="size-4" />
          {initial.connected ? "Hubungkan ulang akun Google" : "Hubungkan akun Google"}
        </a>
        <Button type="button" size="sm" variant="ghost" disabled={busy || !initial.connected} onClick={() => runOp(testGDriveAction)}>
          <HardDriveUpload aria-hidden className="size-4" /> Tes koneksi
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy || !initial.connected} onClick={() => runOp(disconnectGDriveAction)}>
          <Unplug aria-hidden className="size-4" /> Putuskan
        </Button>
        {opMsg ? (
          <span className={`text-[12px] ${opMsg.tone === "success" ? "text-success" : "text-danger"}`}>{opMsg.text}</span>
        ) : null}
      </div>
      <HelpText>
        Gunakan akun Gmail yang terdaftar sebagai <span className="font-medium">editor</span> di folder Drive
        pemberian KKP. Setelah terhubung, isi folder Drive di masing-masing halaman paket.
      </HelpText>
    </div>
  );
}
