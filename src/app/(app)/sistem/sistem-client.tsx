"use client";

import { useActionState, useTransition, useState } from "react";
import { Banner, Button, Combobox, Input, Label, StatusPill } from "@/components/ui";
import {
  runR2Test,
  resetOperationalData,
  saveBranding,
  savePhotoStampConfigAction,
  saveActivityKindAction,
  type R2TestState,
  type ResetState,
  type BrandingState,
  type PhotoStampState,
  type ActivityKindState,
} from "@/lib/system/actions";
import {
  saveWahaConfigAction,
  wahaStatusAction,
  generateWahaWebhookSecretAction,
  type WaActionState,
} from "@/lib/waha/actions";
import type { PhotoStampConfig } from "@/lib/photo-stamp/config";
import { getContrastText, normalizeHex } from "@/lib/photo-stamp/format";

/**
 * Konfigurasi WAHA (WhatsApp) sebagai SETTING APLIKASI — URL server, API key,
 * nama sesi — plus tombol cek status/sesi. API key ditampilkan tersamar;
 * kosongkan untuk mempertahankan key lama. Panduan deploy: docs/WAHA_SETUP.md.
 */
export function WahaConfigPanel({
  initial,
}: {
  initial: { baseUrl: string; session: string; hasApiKey: boolean };
}) {
  const [state, action, pending] = useActionState<WaActionState, FormData>(saveWahaConfigAction, undefined);
  const [testing, startTest] = useTransition();
  const [result, setResult] = useState<
    { ok: true; status: string; me: string | null } | { ok: false; error: string } | null
  >(null);
  const statusTone = (s: string) => (s === "WORKING" ? "success" : s === "SCAN_QR_CODE" ? "warning" : "neutral");
  const configured = initial.hasApiKey && initial.baseUrl.length > 0;

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        {state?.error ? <Banner tone="error" title={state.error} /> : null}
        {state?.success ? <Banner tone="success" title={state.success} /> : null}
        <div>
          <Label htmlFor="waha-url">URL server WAHA</Label>
          <Input id="waha-url" name="baseUrl" defaultValue={initial.baseUrl} placeholder="https://waha-xxxx.up.railway.app" />
        </div>
        <div>
          <Label htmlFor="waha-key">API key</Label>
          <Input
            id="waha-key"
            name="apiKey"
            type="password"
            autoComplete="new-password"
            placeholder={initial.hasApiKey ? "•••••••• (tersimpan — isi untuk mengganti)" : "API key WAHA"}
          />
          <p className="mt-1 text-xs text-ink-muted">
            Kosongkan untuk mempertahankan key yang sudah tersimpan. Ketik tanda minus lalu simpan untuk menghapus.
          </p>
        </div>
        <div>
          <Label htmlFor="waha-session">Nama sesi</Label>
          <Input id="waha-session" name="session" defaultValue={initial.session} placeholder="default" />
        </div>
        <Button type="submit" loading={pending}>Simpan konfigurasi WhatsApp</Button>
      </form>

      <div className="border-t border-border pt-3">
        <Button
          type="button"
          variant="secondary"
          loading={testing}
          disabled={!configured}
          onClick={() => startTest(async () => setResult(await wahaStatusAction()))}
        >
          Cek status WhatsApp
        </Button>
        {!configured ? (
          <p className="mt-2 text-[13px] text-ink-muted">
            Isi & simpan URL + API key dulu, lalu login sesi WhatsApp (scan QR di dashboard WAHA). Panduan: docs/WAHA_SETUP.md.
          </p>
        ) : null}
        {result?.ok === true ? (
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-ink-muted">Sesi:</span>
              <StatusPill tone={statusTone(result.status)} label={result.status} />
            </div>
            {result.status === "WORKING" ? (
              <p className="text-[13px] text-ink-muted">Terhubung sebagai {result.me ?? "—"}. Siap mengirim.</p>
            ) : (
              <p className="text-[13px] text-warning">
                Sesi belum siap. Buka dashboard WAHA dan scan QR dengan akun WhatsApp pengirim.
              </p>
            )}
          </div>
        ) : result?.ok === false ? (
          <Banner tone="error" title={result.error} className="mt-2" />
        ) : null}
      </div>
    </div>
  );
}

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

/**
 * Pengaturan Cap Foto (Photo Stamp): warna aksen (picker + HEX), kekuatan
 * overlay, ukuran, dan toggle koordinat/pelapor/Photo ID — dengan PRATINJAU
 * LANGSUNG (badge + kontras teks otomatis). Berlaku pada cap foto berikutnya;
 * warna foto asli tidak diubah.
 */
export function PhotoStampPanel({ initial }: { initial: PhotoStampConfig }) {
  const [state, action, pending] = useActionState<PhotoStampState, FormData>(savePhotoStampConfigAction, undefined);
  const v = state?.values ?? initial;
  const [accent, setAccent] = useState(v.accentColor);
  const safe = normalizeHex(accent) ?? "#FF8A00";
  const onAccent = getContrastText(safe);

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <p className="text-sm text-ink-muted">
        Warna aksen dipakai semua elemen cap (garis panel, badge, ikon, aksen logo). Perubahan berlaku
        pada cap foto berikutnya — tidak mengubah warna foto asli.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ps-accent">Warna aksen</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pilih warna aksen"
              value={safe}
              onChange={(e) => setAccent(e.target.value.toUpperCase())}
              className="h-9 w-12 cursor-pointer rounded-md border border-border bg-surface p-0.5"
            />
            <Input
              id="ps-accent"
              name="accentColor"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              maxLength={7}
              className="w-32 font-mono"
            />
            <button type="button" onClick={() => setAccent("#FF8A00")} className="text-xs font-medium text-primary hover:underline">
              Reset
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="ps-overlay">Kekuatan overlay</Label>
          <Combobox id="ps-overlay" name="overlayStrength" defaultValue={v.overlayStrength}>
            <option value="auto">Auto</option>
            <option value="light">Ringan</option>
            <option value="standard">Standar</option>
            <option value="strong">Kuat</option>
          </Combobox>
        </div>
        <div>
          <Label htmlFor="ps-size">Ukuran stamp</Label>
          <Combobox id="ps-size" name="size" defaultValue={v.size}>
            <option value="compact">Compact</option>
            <option value="standard">Standard</option>
            <option value="large">Large</option>
          </Combobox>
        </div>
        <fieldset className="space-y-1.5">
          <Label>Tampilkan di cap</Label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="showCoordinates" defaultChecked={v.showCoordinates} /> Koordinat
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="showReporter" defaultChecked={v.showReporter} /> Nama pelapor
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="showPhotoId" defaultChecked={v.showPhotoId} /> Photo ID
          </label>
        </fieldset>
      </div>

      {/* Pratinjau langsung */}
      <div>
        <Label>Pratinjau</Label>
        <div className="rounded-lg border border-border bg-[#0b1a30] p-4">
          <span
            className="inline-flex rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: safe, color: onAccent }}
          >
            Kondisi Eksisting
          </span>
          <div className="mt-2 text-2xl font-extrabold leading-tight text-white">KNMP Purwahamba</div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-300">
            <span style={{ color: safe }} aria-hidden>
              ●
            </span>
            Koordinat: 6.871010°S, 109.253123°E
          </div>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Teks badge otomatis kontras (putih/gelap) mengikuti warna aksen. Contoh badge di atas memakai warna terpilih.
        </p>
      </div>

      <Button type="submit" loading={pending}>
        Simpan pengaturan cap foto
      </Button>
    </form>
  );
}

/**
 * Master data "Jenis kegiatan lapangan" — kelola pilihan dropdown kegiatan tanpa
 * developer: tambah jenis baru, ubah nama, aktif/nonaktifkan. Key stabil supaya
 * data lama tetap tertaut walau jenis dinonaktifkan. DECISIONS 115.
 */
export function ActivityKindsPanel({
  kinds,
}: {
  kinds: { key: string; label: string; isActive: boolean; sortOrder: number }[];
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Pilihan ini muncul di dropdown <span className="font-medium">Jenis kegiatan</span> saat mencatat
        kegiatan lapangan. Menonaktifkan jenis menyembunyikannya dari dropdown tanpa mengubah data lama.
      </p>
      <AddActivityKindForm />
      <ul className="divide-y divide-border rounded-md border border-border">
        {kinds.map((k) => (
          <ActivityKindRow key={k.key} kind={k} />
        ))}
      </ul>
    </div>
  );
}

function AddActivityKindForm() {
  const [state, action, pending] = useActionState<ActivityKindState, FormData>(saveActivityKindAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-muted p-3">
      <div className="min-w-56 flex-1">
        <Label htmlFor="ak-new">Tambah jenis kegiatan</Label>
        <Input id="ak-new" name="label" placeholder="mis. Survei Awal" maxLength={60} required />
      </div>
      <Button type="submit" size="sm" loading={pending}>Tambah</Button>
      {state?.error ? <div className="w-full"><Banner tone="error" title={state.error} /></div> : null}
      {state?.success ? <div className="w-full"><Banner tone="success" title={state.success} /></div> : null}
    </form>
  );
}

function ActivityKindRow({ kind }: { kind: { key: string; label: string; isActive: boolean; sortOrder: number } }) {
  const [state, action, pending] = useActionState<ActivityKindState, FormData>(saveActivityKindAction, undefined);
  return (
    <li className="p-3">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="key" value={kind.key} />
        <Input name="label" defaultValue={kind.label} maxLength={60} className="min-w-48 flex-1" required />
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          <input type="checkbox" name="isActive" defaultChecked={kind.isActive} /> Aktif
        </label>
        <StatusPill tone={kind.isActive ? "success" : "neutral"} label={kind.isActive ? "Aktif" : "Nonaktif"} />
        <Button type="submit" size="sm" variant="secondary" loading={pending}>Simpan</Button>
      </form>
      {state?.error ? <div className="mt-1.5"><Banner tone="error" title={state.error} /></div> : null}
      {state?.success ? <p className="mt-1 text-xs text-success">{state.success}</p> : null}
    </li>
  );
}

/**
 * Webhook inbound WAHA — tangkap percakapan grup ke arsip per paket (fondasi
 * integrasi AI). Admin men-generate secret, menyalin URL webhook ke WAHA, lalu
 * pesan grup tertaut paket mulai tertangkap. DECISIONS 119.
 */
export function WahaWebhookPanel({
  webhookUrl,
  hasSecret,
  capturedCount,
  lastCapturedAt,
}: {
  webhookUrl: string | null;
  hasSecret: boolean;
  capturedCount: number;
  lastCapturedAt: string | null;
}) {
  const [state, action, pending] = useActionState<WaActionState, FormData>(
    generateWahaWebhookSecretAction,
    undefined,
  );
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <p className="text-sm text-ink-muted">
        Menangkap percakapan grup WhatsApp (hanya grup yang sudah ditautkan ke paket) ke arsip —
        fondasi ringkasan/telusur berbasis AI. Butuh langkah di WAHA: pasang URL webhook di bawah &
        aktifkan event <span className="font-mono">message</span>.
      </p>

      {hasSecret && webhookUrl ? (
        <div>
          <Label htmlFor="wh-url">URL webhook (salin ke WAHA)</Label>
          <div className="flex items-center gap-2">
            <Input id="wh-url" readOnly value={webhookUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(webhookUrl);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard bisa gagal di http non-secure — user salin manual */
                }
              }}
            >
              {copied ? "Tersalin" : "Salin"}
            </Button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            URL memuat token rahasia. Merotasi secret membuat URL lama berhenti berfungsi.
          </p>
        </div>
      ) : (
        <Banner tone="info" title="Webhook belum diaktifkan" description="Buat secret dulu untuk mendapatkan URL webhook." />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <form action={action}>
          <Button type="submit" variant={hasSecret ? "secondary" : "primary"} loading={pending}>
            {hasSecret ? "Rotasi secret" : "Aktifkan & buat secret"}
          </Button>
        </form>
        <span className="text-[13px] text-ink-muted">
          {capturedCount > 0
            ? `${capturedCount.toLocaleString("id-ID")} pesan tertangkap${lastCapturedAt ? ` · terakhir ${lastCapturedAt}` : ""}`
            : "Belum ada pesan tertangkap."}
        </span>
      </div>
    </div>
  );
}
