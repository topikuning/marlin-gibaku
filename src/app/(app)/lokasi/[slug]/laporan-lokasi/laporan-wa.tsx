"use client";

import { useActionState } from "react";
import { MessageCircle } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import {
  sendDailyReportToWaAction,
  sendPeriodReportToWaAction,
  type WaActionState,
} from "@/lib/waha/actions";
import { formatTanggalWaktu } from "@/lib/format";

/** Tombol kirim laporan periodik (mingguan/bulanan) sebagai Excel ke grup WA. */
export function SendPeriodReportWaButton({
  locationId,
  kind,
  n,
  hasGroup,
}: {
  locationId: string;
  kind: "mingguan" | "bulanan";
  n: number;
  hasGroup: boolean;
}) {
  const [state, action, pending] = useActionState<WaActionState, FormData>(sendPeriodReportToWaAction, undefined);
  return (
    <div className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <form action={action}>
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="n" value={n} />
        <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={!hasGroup}>
          <MessageCircle aria-hidden className="size-4" /> Kirim ke WhatsApp (Excel)
        </Button>
        {!hasGroup ? (
          <span className="ml-2 text-[12px] text-ink-muted">Paket belum punya grup WA.</span>
        ) : null}
      </form>
    </div>
  );
}

/** Tombol kirim laporan harian (Excel) ke grup WA + status "sudah dikirim". */
export function SendDailyReportWaButton({
  slug,
  dateKey,
  hasGroup,
  sentAt,
}: {
  slug: string;
  dateKey: string;
  hasGroup: boolean;
  sentAt: string | null;
}) {
  const [state, action, pending] = useActionState<WaActionState, FormData>(sendDailyReportToWaAction, undefined);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {state?.error ? <span className="text-[12px] text-danger">{state.error}</span> : null}
      {state?.success ? <span className="text-[12px] text-success">{state.success}</span> : null}
      {sentAt && !state?.success ? (
        <span className="text-[12px] text-success">✓ WA {formatTanggalWaktu(new Date(sentAt))}</span>
      ) : null}
      <form action={action} className="inline">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="dateKey" value={dateKey} />
        <Button type="submit" size="sm" variant="ghost" loading={pending} disabled={!hasGroup}>
          <MessageCircle aria-hidden className="size-3.5" /> {sentAt ? "Kirim ulang WA" : "Kirim WA"}
        </Button>
      </form>
    </span>
  );
}
