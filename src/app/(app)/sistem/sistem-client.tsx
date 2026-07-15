"use client";

import { useActionState, useTransition, useState } from "react";
import { Banner, Button, Input, Label, StatusPill } from "@/components/ui";
import {
  runR2Test,
  resetOperationalData,
  saveBranding,
  type R2TestState,
  type ResetState,
  type BrandingState,
} from "@/lib/system/actions";

export function BrandingPanel({
  initial,
  defaults,
}: {
  initial: { appName: string; tagline: string; projectContext: string };
  defaults: { appName: string; tagline: string; projectContext: string };
}) {
  const [state, action, pending] = useActionState<BrandingState, FormData>(saveBranding, undefined);
  const v = state?.values ?? initial;
  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <p className="text-sm text-ink-muted">
        Identitas produk dipakai di halaman masuk & seluruh aplikasi. Konteks proyek bersifat tambahan —
        ubah bila dipakai untuk proyek lain. Kosongkan untuk memakai nilai bawaan.
      </p>
      <div>
        <Label htmlFor="brand-app">Nama aplikasi</Label>
        <Input id="brand-app" name="appName" defaultValue={v.appName} maxLength={60} placeholder={defaults.appName} />
      </div>
      <div>
        <Label htmlFor="brand-tagline">Tagline (kepanjangan)</Label>
        <Input
          id="brand-tagline"
          name="tagline"
          defaultValue={v.tagline}
          maxLength={160}
          placeholder={defaults.tagline}
        />
      </div>
      <div>
        <Label htmlFor="brand-project">Konteks proyek (tambahan)</Label>
        <Input
          id="brand-project"
          name="projectContext"
          defaultValue={v.projectContext}
          maxLength={160}
          placeholder={defaults.projectContext}
        />
      </div>
      <Button type="submit" loading={pending}>
        Simpan branding
      </Button>
    </form>
  );
}

export function R2TestPanel({ configured }: { configured: boolean }) {
  const [result, setResult] = useState<R2TestState>(undefined);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3">
      {!configured && (
        <Banner
          tone="info"
          title="R2 belum dikonfigurasi"
          description="Isi R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. Endpoint harus <accountid>.r2.cloudflarestorage.com."
        />
      )}
      <Button
        onClick={() => startTransition(async () => setResult(await runR2Test()))}
        loading={pending}
        variant="secondary"
      >
        Jalankan tes R2
      </Button>
      {result && (
        <ul className="space-y-1 text-sm">
          {result.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <StatusPill tone={s.ok ? "success" : "danger"} label={s.step} />
              <span className="text-ink-muted">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {result?.stampSampleDataUri && (
        <div className="space-y-1">
          <p className="text-xs text-ink-muted">
            Pratinjau cap foto (dirender di server ini) — teks harus terbaca. Bila kosong/tanpa teks, cap
            bermasalah di host ini.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URI hasil render server, bukan asset Next */}
          <img
            src={result.stampSampleDataUri}
            alt="Pratinjau cap foto"
            className="w-full max-w-md rounded-lg border border-border"
          />
        </div>
      )}
    </div>
  );
}

export function ResetPanel() {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetOperationalData, undefined);
  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <p className="text-sm text-ink-muted">
        Mengosongkan seluruh laporan harian, foto, dan kendala. Master (paket, kontrak, lokasi, RAB, baseline,
        pengguna, keuangan) tidak disentuh.
      </p>
      <div>
        <Label htmlFor="reset-confirm" required>
          Ketik <span className="font-mono">KOSONGKAN</span> untuk konfirmasi
        </Label>
        <Input id="reset-confirm" name="confirm" autoComplete="off" className="w-56" />
      </div>
      <Button type="submit" variant="danger" loading={pending}>
        Kosongkan data operasional
      </Button>
    </form>
  );
}
