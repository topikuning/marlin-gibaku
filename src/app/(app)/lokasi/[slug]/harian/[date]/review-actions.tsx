"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Printer, Undo2 } from "lucide-react";
import { Banner, Button, Label, Textarea } from "@/components/ui";
import {
  addIssueAction,
  approveReportAction,
  finalizeReportAction,
  returnReportAction,
  type DailyActionState,
} from "@/lib/daily-report/actions";
import { ISSUE_SEVERITY_LABEL } from "@/lib/daily-report/constants";
import { Select } from "@/components/ui";

/** Aksi reviewer (dikirim): Setujui / Kembalikan (alasan wajib). */
export function ReviewActions({ reportId }: { reportId: string }) {
  const [approveState, approveAction, approvePending] = useActionState<DailyActionState, FormData>(
    approveReportAction,
    undefined,
  );
  const [returnState, returnAction, returnPending] = useActionState<DailyActionState, FormData>(
    returnReportAction,
    undefined,
  );
  const [showReturn, setShowReturn] = useState(false);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-ink">Verifikasi laporan</h2>
      {approveState?.error ? <Banner tone="error" title={approveState.error} /> : null}
      {approveState?.success ? <Banner tone="success" title={approveState.success} /> : null}
      {returnState?.error ? <Banner tone="error" title={returnState.error} /> : null}
      {returnState?.success ? <Banner tone="success" title={returnState.success} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <form action={approveAction} className="flex-1">
          <input type="hidden" name="reportId" value={reportId} />
          <Button type="submit" loading={approvePending} className="h-11 w-full">
            <CheckCircle2 aria-hidden className="size-4" />
            Setujui
          </Button>
        </form>
        <Button
          type="button"
          variant="secondary"
          className="h-11 flex-1"
          onClick={() => setShowReturn((v) => !v)}
        >
          <Undo2 aria-hidden className="size-4" />
          Kembalikan
        </Button>
      </div>

      {showReturn ? (
        <form action={returnAction} className="space-y-2 rounded-md border border-warning-border bg-warning-soft p-3">
          <input type="hidden" name="reportId" value={reportId} />
          <div>
            <Label htmlFor="rv-reason" required>
              Alasan pengembalian (dibaca SM di lapangan)
            </Label>
            <Textarea
              id="rv-reason"
              name="reason"
              required
              minLength={3}
              maxLength={1000}
              placeholder="mis. volume pasangan bata tidak sesuai foto — cek ulang zona B"
            />
          </div>
          <Button type="submit" variant="danger" loading={returnPending}>
            Kirim Kembali untuk Koreksi
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Aksi finalisasi (disetujui) + link cetak setelah final. */
export function FinalizePanel({
  reportId,
  slug,
  dateKey,
  isFinal,
}: {
  reportId: string;
  slug: string;
  dateKey: string;
  isFinal: boolean;
}) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    finalizeReportAction,
    undefined,
  );

  if (isFinal) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-success-border bg-success-soft p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-ink">Laporan final — angka dibekukan untuk cetak KKP.</p>
        <Link
          href={`/cetak/harian/${slug}/${dateKey}`}
          target="_blank"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-800"
        >
          <Printer aria-hidden className="size-4" />
          Cetak Laporan KKP
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-ink">Finalisasi</h2>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="reportId" value={reportId} />
      <Button type="submit" loading={pending} className="h-11 w-full sm:w-auto">
        Finalisasi Laporan
      </Button>
      <p className="text-[11px] text-ink-muted">
        Finalisasi membekukan snapshot angka (immutable) untuk cetak laporan KKP. Tidak bisa dibatalkan.
      </p>
    </form>
  );
}

/** Form tambah kendala hari itu (menempel ke laporan). */
export function IssueForm({ reportId }: { reportId: string }) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(addIssueAction, undefined);
  return (
    <form action={formAction} className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="reportId" value={reportId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Label htmlFor="is-title" required>
            Kendala baru
          </Label>
          <input
            id="is-title"
            name="title"
            required
            minLength={3}
            maxLength={200}
            placeholder="mis. hujan deras sejak siang, cor ditunda"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
          />
        </div>
        <div className="w-full sm:w-32">
          <Label htmlFor="is-severity">Tingkat</Label>
          <Select id="is-severity" name="severity" defaultValue="sedang">
            {(Object.keys(ISSUE_SEVERITY_LABEL) as (keyof typeof ISSUE_SEVERITY_LABEL)[]).map((s) => (
              <option key={s} value={s}>
                {ISSUE_SEVERITY_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="is-desc">Uraian (opsional)</Label>
        <Textarea id="is-desc" name="description" rows={2} maxLength={2000} />
      </div>
      <Button type="submit" variant="secondary" loading={pending}>
        Catat Kendala
      </Button>
    </form>
  );
}
