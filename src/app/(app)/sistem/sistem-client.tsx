"use client";

import { useActionState, useTransition, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Banner, Button, Combobox, Input, Label, StatusPill } from "@/components/ui";

/**
 * Tab switcher client-side untuk hub Pengaturan Sistem — ganti panel tanpa
 * reload. Panel dibangun di server & dioper sebagai ReactNode per key.
 */
export function SettingsTabs({
  tabs,
  panels,
}: {
  tabs: { key: string; label: string }[];
  panels: Record<string, ReactNode>;
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  return (
    <div>
      <nav aria-label="Tab pengaturan" className="border-b border-border">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => setActive(t.key)}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "inline-block border-b-2 px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors",
                    on
                      ? "border-primary text-primary"
                      : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink",
                  )}
                >
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-5">{panels[active]}</div>
    </div>
  );
}
import {
  runR2Test,
  resetOperationalData,
  rebuildFinalSnapshots,
  saveBranding,
  savePhotoStampConfigAction,
  saveActivityKindAction,
  type R2TestState,
  type ResetState,
  type RebuildSnapshotState,
  type BrandingState,
  type PhotoStampState,
  type ActivityKindState,
} from "@/lib/system/actions";
import {
  saveWahaConfigAction,
  wahaStatusAction,
  generateWahaWebhookSecretAction,
  testWahaCaptureAction,
  type WaActionState,
} from "@/lib/waha/actions";
import {
  saveAiProviderAction,
  setActiveAiProviderAction,
  testAiProviderAction,
  listAiModelsAction,
  type AiActionState,
  type AiModelsState,
} from "@/lib/ai/actions";
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
  ownerLogoUrl,
}: {
  initial: { appName: string; tagline: string; projectContext: string; ownerName: string; ownerSubtitle: string };
  defaults: { appName: string; tagline: string; projectContext: string; ownerName: string; ownerSubtitle: string };
  ownerLogoUrl?: string | null;
}) {
  const [state, action, pending] = useActionState<BrandingState, FormData>(saveBranding, undefined);
  const v = state?.values ?? initial;
  return (
    // encType multipart — form ini membawa berkas logo pemilik pekerjaan.
    <form action={action} encType="multipart/form-data" className="space-y-3">
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
      <div className="mt-4 space-y-3 rounded-md border border-border bg-surface-muted p-3">
        <p className="text-sm font-semibold text-ink">Pemilik Pekerjaan (kop laporan)</p>
        <p className="text-xs text-ink-muted">
          Nama, keterangan, dan logo instansi pemberi pekerjaan — dipakai di kop blanko laporan harian
          dan periodik. Ubah bila proyek ini bukan milik KKP.
        </p>
        <div>
          <Label htmlFor="brand-owner">Nama pemilik pekerjaan</Label>
          <Input
            id="brand-owner"
            name="ownerName"
            defaultValue={v.ownerName}
            maxLength={120}
            placeholder={defaults.ownerName}
          />
        </div>
        <div>
          <Label htmlFor="brand-owner-sub">Keterangan / nama program</Label>
          <Input
            id="brand-owner-sub"
            name="ownerSubtitle"
            defaultValue={v.ownerSubtitle}
            maxLength={160}
            placeholder={defaults.ownerSubtitle}
          />
        </div>
        <div>
          <Label htmlFor="brand-owner-logo">Logo pemilik pekerjaan (PNG/JPG/WebP, maks 2 MB)</Label>
          {ownerLogoUrl ? (
            <div className="mb-2 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ownerLogoUrl} alt="Logo pemilik pekerjaan" className="h-12 w-auto rounded border border-border bg-white p-1" />
              <span className="text-xs text-ink-muted">Logo terpasang — unggah berkas baru untuk mengganti.</span>
            </div>
          ) : (
            <p className="mb-2 text-xs text-ink-muted">Belum ada logo — kop memakai teks saja.</p>
          )}
          <input
            id="brand-owner-logo"
            name="ownerLogo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="block w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-surface-inset file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
          />
        </div>
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

/**
 * Bangun ulang snapshot laporan harian final — koreksi angka cetakan tanpa
 * menyentuh status/volume/input. Tersedia di production (beda dari Reset).
 * DECISIONS 148.
 */
export function RebuildSnapshotPanel({ locations }: { locations: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<RebuildSnapshotState, FormData>(
    rebuildFinalSnapshots,
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <p className="text-sm text-ink-muted">
        Menghitung ulang angka pada <span className="font-medium">cetakan laporan harian final</span> dari data
        laporan yang sama. Status, volume, dan input TIDAK disentuh — aman diulang. Perlu dijalankan setelah
        perbaikan rumus supaya laporan yang terlanjur final ikut benar.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="rebuild-loc">Cakupan</Label>
          <select
            id="rebuild-loc"
            name="locationId"
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="">Semua lokasi</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary" loading={pending}>
          {pending ? "Menghitung ulang…" : "Bangun ulang snapshot"}
        </Button>
      </div>
    </form>
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
  hits,
}: {
  webhookUrl: string | null;
  hasSecret: boolean;
  capturedCount: number;
  lastCapturedAt: string | null;
  hits: { at: string; tokenOk: boolean; event: string; chatId: string | null; outcome: string }[];
}) {
  const [state, action, pending] = useActionState<WaActionState, FormData>(
    generateWahaWebhookSecretAction,
    undefined,
  );
  const [testState, testAction, testing] = useActionState<WaActionState, FormData>(
    testWahaCaptureAction,
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
        aktifkan event <span className="font-mono">message.any</span>.
      </p>
      <Banner
        tone="info"
        title="Pakai message.any, bukan message"
        description="Event message hanya membawa pesan MASUK. Kiriman MARLIN sendiri (laporan harian/kegiatan yang dikirim ke grup) hanya ikut terarsip lewat message.any — tanpa itu ringkasan harian tidak utuh."
      />

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

      {/* Diagnostik: self-test + log 10 hit webhook terakhir yang mendarat. */}
      <div className="rounded-md border border-border bg-surface-inset p-3">
        {testState?.error ? <Banner tone="error" title={testState.error} className="mb-2" /> : null}
        {testState?.success ? <Banner tone="success" title={testState.success} className="mb-2" /> : null}
        {testState?.warning ? <Banner tone="warning" title={testState.warning} className="mb-2" /> : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-ink">Diagnostik webhook</p>
          <form action={testAction}>
            <Button type="submit" size="sm" variant="secondary" loading={testing}>
              Kirim event uji (cek sisi MARLIN)
            </Button>
          </form>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Tombol di atas mensimulasikan 1 event WAHA ke grup tertaut — membuktikan jalur terima→simpan
          MARLIN sehat, lepas dari WAHA. Tabel di bawah mencatat <b>setiap</b> POST yang benar-benar
          mendarat (10 terakhir): kalau kosong setelah kirim pesan → WAHA belum sampai ke server.
        </p>

        {hits.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-muted">
            Belum ada hit tercatat. Kirim pesan uji di grup, lalu muat ulang halaman ini.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted">
                  <th className="py-1.5 pr-3 font-medium">Waktu</th>
                  <th className="py-1.5 pr-3 font-medium">Token</th>
                  <th className="py-1.5 pr-3 font-medium">Event</th>
                  <th className="py-1.5 font-medium">Hasil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {hits.map((hit, i) => (
                  <tr key={i}>
                    <td className="tabular py-1.5 pr-3 whitespace-nowrap">{hit.at}</td>
                    <td className="py-1.5 pr-3">
                      {hit.tokenOk ? (
                        <span className="text-success">valid</span>
                      ) : (
                        <span className="text-danger">salah</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{hit.event}</td>
                    <td className="py-1.5">
                      {hit.outcome}
                      {hit.chatId ? <span className="block font-mono text-xs text-ink-muted">{hit.chatId}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Provider AI (Claude / OpenAI / Mistral / Grok) ─────────────────────── */

type AiProviderCardData = {
  id: string;
  label: string;
  defaultModel: string;
  keyHint: string;
  hasApiKey: boolean;
  model: string;
  knownModels: string[];
};

function AiProviderCard({ p, active }: { p: AiProviderCardData; active: boolean }) {
  const [saveState, saveAction, saving] = useActionState<AiActionState, FormData>(saveAiProviderAction, undefined);
  const [testState, testAction, testing] = useActionState<AiActionState, FormData>(testAiProviderAction, undefined);
  const [activateState, activateAction, activating] = useActionState<AiActionState, FormData>(
    setActiveAiProviderAction,
    undefined,
  );
  const [modelsState, listAction, listing] = useActionState<AiModelsState, FormData>(listAiModelsAction, undefined);
  const [model, setModel] = useState(p.model);
  const banner = saveState ?? testState ?? activateState;

  // Saran model: gabung yang tersimpan + hasil live /models + kurasi dokumentasi.
  const fetched = modelsState?.models ?? [];
  const suggestions = Array.from(
    new Set([...(model ? [model] : []), ...fetched, ...p.knownModels]),
  );

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        active ? "border-primary bg-primary-50" : "border-border bg-surface",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">{p.label}</h4>
          {active ? (
            <StatusPill tone="success" label="Aktif" />
          ) : (
            <StatusPill tone={p.hasApiKey ? "neutral" : "warning"} label={p.hasApiKey ? "Siap" : "Belum ada key"} />
          )}
        </div>
        {active ? null : (
          <form action={activateAction}>
            <input type="hidden" name="provider" value={p.id} />
            <Button type="submit" size="sm" variant="secondary" loading={activating} disabled={!p.hasApiKey}>
              Jadikan aktif
            </Button>
          </form>
        )}
      </div>

      {banner?.error ? <Banner tone="error" title={banner.error} className="mt-2" /> : null}
      {banner?.success ? <Banner tone="success" title={banner.success} className="mt-2" /> : null}
      {modelsState?.error ? <Banner tone="error" title={modelsState.error} className="mt-2" /> : null}
      {modelsState?.models ? (
        <Banner tone="success" title={`${modelsState.models.length} model dimuat dari API.`} className="mt-2" />
      ) : null}

      <form action={saveAction} className="mt-3 space-y-2">
        <input type="hidden" name="provider" value={p.id} />
        <div>
          <Label>Model</Label>
          <input type="hidden" name="model" value={model} />
          <Combobox
            options={suggestions.map((m) => ({ value: m, label: m }))}
            value={suggestions.includes(model) ? model : ""}
            onChange={setModel}
            placeholder={`Pilih model… (${suggestions.length} pilihan)`}
          />
          <Input
            className="mt-2"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={`atau ketik manual (mis. ${p.defaultModel})`}
          />
          <p className="mt-1 text-xs text-ink-muted">
            Pilih dari daftar (klik <b>Muat model</b> untuk daftar terkini{fetched.length > 0 ? ` — ${fetched.length} dari API` : ""})
            atau ketik nama model kustom.
          </p>
        </div>
        <div>
          <Label htmlFor={`ai-key-${p.id}`}>API key</Label>
          <Input
            id={`ai-key-${p.id}`}
            name="apiKey"
            type="password"
            autoComplete="new-password"
            placeholder={p.hasApiKey ? "•••••••• (tersimpan — isi untuk mengganti)" : `API key dari ${p.keyHint}`}
          />
          <p className="mt-1 text-xs text-ink-muted">
            Kosongkan untuk mempertahankan key tersimpan. Ketik tanda minus lalu simpan untuk menghapus.
          </p>
        </div>
        <Button type="submit" size="sm" loading={saving}>
          Simpan
        </Button>
      </form>

      <div className="mt-2 flex flex-wrap gap-2">
        <form action={testAction}>
          <input type="hidden" name="provider" value={p.id} />
          <Button type="submit" size="sm" variant="secondary" loading={testing} disabled={!p.hasApiKey}>
            Tes koneksi
          </Button>
        </form>
        <form action={listAction}>
          <input type="hidden" name="provider" value={p.id} />
          <Button type="submit" size="sm" variant="secondary" loading={listing} disabled={!p.hasApiKey}>
            Muat model
          </Button>
        </form>
      </div>
    </div>
  );
}

/**
 * Panel provider AI — atur beberapa provider (Claude/OpenAI/Mistral/Grok) &
 * pilih satu yang aktif. Fitur AI (mis. ringkasan WA) memakai provider aktif.
 * DECISIONS 121.
 */
export function AiProvidersPanel({
  activeProvider,
  providers,
}: {
  activeProvider: string | null;
  providers: AiProviderCardData[];
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Isi API key untuk provider yang ingin dipakai, lalu klik <b>Jadikan aktif</b> pada salah satunya.
        Fitur AI di MARLIN memakai provider aktif. Server harus punya egress ke host provider.
        {activeProvider ? null : " Belum ada provider aktif."}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {providers.map((p) => (
          <AiProviderCard key={p.id} p={p} active={p.id === activeProvider} />
        ))}
      </div>
    </div>
  );
}
