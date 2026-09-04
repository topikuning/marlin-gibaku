"use client";

import { useAksi } from "@/lib/aksi-klien";


import { Banner, Button } from "@/components/ui";
import { updateAiGuardAction, type AiHubState } from "@/lib/ai-hub/actions";

/**
 * Panel kontrol AI Hub (Sistem → AI): kill switch, rate limit, batas ukuran,
 * pricing token utk estimasi biaya, dan status enkripsi API key. system.manage.
 */
export function AiGuardPanel({
  enabled,
  maxRunsPerUserPerHour,
  maxRunsPerOrgPerDay,
  maxLocationsPerRun,
  maxInputChars,
  maxOutputTokens,
  pricing,
  secretStatus,
}: {
  enabled: boolean;
  maxRunsPerUserPerHour: number;
  maxRunsPerOrgPerDay: number;
  maxLocationsPerRun: number;
  maxInputChars: number;
  maxOutputTokens: number;
  pricing: { inUsdPerMTok: number; outUsdPerMTok: number } | null;
  secretStatus: { encrypted: boolean; detail: string };
}) {
  const [state, formAction, pending] = useAksi<AiHubState>(updateAiGuardAction, undefined);
  return (
    <form action={formAction} className="space-y-3">
      <Banner
        tone={secretStatus.encrypted ? "success" : "warning"}
        title={secretStatus.encrypted ? "API key terenkripsi at-rest" : "API key BELUM terenkripsi"}
        description={secretStatus.detail}
      />
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.ok ? <Banner tone="success" title={state.ok} /> : null}

      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        Fitur AI aktif (matikan = kill switch global, semua run ditolak & diaudit)
      </label>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-xs text-ink-muted">
          Maks run / user / jam
          <input
            type="number"
            name="maxRunsPerUserPerHour"
            defaultValue={maxRunsPerUserPerHour}
            min={1}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-ink-muted">
          Maks run / hari (org)
          <input
            type="number"
            name="maxRunsPerOrgPerDay"
            defaultValue={maxRunsPerOrgPerDay}
            min={1}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-ink-muted">
          Maks lokasi / run
          <input
            type="number"
            name="maxLocationsPerRun"
            defaultValue={maxLocationsPerRun}
            min={1}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-ink-muted">
          Maks karakter input
          <input
            type="number"
            name="maxInputChars"
            defaultValue={maxInputChars}
            min={10000}
            step={10000}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-ink-muted">
          Maks output token
          <input
            type="number"
            name="maxOutputTokens"
            defaultValue={maxOutputTokens}
            min={256}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-ink"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-ink-muted">
          Harga input USD / 1 jt token (opsional – utk estimasi biaya, bukan kill switch)
          <input
            type="number"
            step="0.01"
            name="inUsdPerMTok"
            defaultValue={pricing?.inUsdPerMTok ?? ""}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-ink-muted">
          Harga output USD / 1 jt token
          <input
            type="number"
            step="0.01"
            name="outUsdPerMTok"
            defaultValue={pricing?.outUsdPerMTok ?? ""}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-ink"
          />
        </label>
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Menyimpan…" : "Simpan pengaturan AI"}
      </Button>
    </form>
  );
}
