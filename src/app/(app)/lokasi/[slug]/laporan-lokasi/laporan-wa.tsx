"use client";

import { useActionState } from "react";
import { FileText, MessageCircle } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import {
  sendDailyReportToWaAction,
  sendDailyReportPdfToWaAction,
  sendPeriodReportToWaAction,
  sendPeriodReportPdfToWaAction,
  type WaActionState,
} from "@/lib/waha/actions";
import { formatTanggalWaktu } from "@/lib/format";

/** Kirim laporan periodik (mingguan/bulanan): PDF ringkas ATAU Excel + unduh PDF. */
export function SendPeriodReportWaButton({
  slug,
  locationId,
  kind,
  n,
  hasGroup,
}: {
  slug: string;
  locationId: string;
  kind: "mingguan" | "bulanan";
  n: number;
  hasGroup: boolean;
}) {
  const [pdfState, pdfAction, pdfPending] = useActionState<WaActionState, FormData>(sendPeriodReportPdfToWaAction, undefined);
  const [xlsState, xlsAction, xlsPending] = useActionState<WaActionState, FormData>(sendPeriodReportToWaAction, undefined);
  const state = pdfState ?? xlsState;
  return (
    <div className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <form action={pdfAction} className="inline">
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="n" value={n} />
          <Button type="submit" size="sm" variant="secondary" loading={pdfPending} disabled={!hasGroup}>
            <MessageCircle aria-hidden className="size-4" /> Kirim ke WhatsApp (PDF)
          </Button>
        </form>
        <form action={xlsAction} className="inline">
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="n" value={n} />
          <Button type="submit" size="sm" variant="ghost" loading={xlsPending} disabled={!hasGroup}>
            <MessageCircle aria-hidden className="size-4" /> Excel
          </Button>
        </form>
        <a
          href={`/api/laporan/periodik/${slug}/${kind}/${n}/pdf`}
          target="_blank"
          rel="noopener"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium text-ink hover:border-border-strong hover:bg-surface-muted"
        >
          <FileText aria-hidden className="size-3.5" /> Unduh PDF
        </a>
        {!hasGroup ? <span className="text-[12px] text-ink-muted">Paket belum punya grup WA.</span> : null}
      </div>
    </div>
  );
}

/** Kirim laporan harian: PDF ringkas ATAU Excel + unduh PDF + status "sudah dikirim". */
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
  const [pdfState, pdfAction, pdfPending] = useActionState<WaActionState, FormData>(sendDailyReportPdfToWaAction, undefined);
  const [xlsState, xlsAction, xlsPending] = useActionState<WaActionState, FormData>(sendDailyReportToWaAction, undefined);
  const state = pdfState ?? xlsState;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {state?.error ? <span className="text-[12px] text-danger">{state.error}</span> : null}
      {state?.success ? <span className="text-[12px] text-success">{state.success}</span> : null}
      {sentAt && !state?.success ? (
        <span className="text-[12px] text-success">✓ WA {formatTanggalWaktu(new Date(sentAt))}</span>
      ) : null}
      <form action={pdfAction} className="inline">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="dateKey" value={dateKey} />
        <Button type="submit" size="sm" variant="ghost" loading={pdfPending} disabled={!hasGroup}>
          <MessageCircle aria-hidden className="size-3.5" /> {sentAt ? "Kirim ulang WA (PDF)" : "Kirim WA (PDF)"}
        </Button>
      </form>
      <form action={xlsAction} className="inline">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="dateKey" value={dateKey} />
        <Button type="submit" size="sm" variant="ghost" loading={xlsPending} disabled={!hasGroup}>
          <MessageCircle aria-hidden className="size-3.5" /> Excel
        </Button>
      </form>
      <a href={`/api/laporan/harian/${slug}/${dateKey}/pdf`} target="_blank" rel="noopener" className="text-[13px] font-medium text-primary hover:underline">
        Unduh PDF
      </a>
    </span>
  );
}
