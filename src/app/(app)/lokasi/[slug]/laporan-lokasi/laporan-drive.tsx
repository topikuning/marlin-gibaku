"use client";

import { useActionState } from "react";
import { HardDriveUpload } from "lucide-react";
import { Button } from "@/components/ui";
import {
  uploadDailyReportToDriveAction,
  uploadPeriodReportToDriveAction,
  type GDriveActionState,
} from "@/lib/gdrive/actions";

/**
 * Upload manual laporan ke folder Google Drive paket (pemberian KKP).
 * Harian = PDF; mingguan/bulanan = PDF + Excel. DECISIONS 141.
 */
export function UploadPeriodToDriveButton({
  locationId,
  kind,
  n,
  hasDrive,
}: {
  locationId: string;
  kind: "mingguan" | "bulanan";
  n: number;
  hasDrive: boolean;
}) {
  const [state, action, pending] = useActionState<GDriveActionState, FormData>(
    uploadPeriodReportToDriveAction,
    undefined,
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <form action={action} className="inline">
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="n" value={n} />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={!hasDrive}
          title={hasDrive ? undefined : "Paket belum punya folder Google Drive (atur di halaman paket)."}
        >
          <HardDriveUpload aria-hidden className="size-4" /> {pending ? "Mengupload…" : "Upload ke Drive (PDF + Excel)"}
        </Button>
      </form>
      {state?.error ? <span className="text-[12px] text-danger">{state.error}</span> : null}
      {state?.success ? <span className="text-[12px] text-success">{state.success}</span> : null}
    </span>
  );
}

export function UploadDailyToDriveButton({
  slug,
  dateKey,
  hasDrive,
  uploadedAt,
}: {
  slug: string;
  dateKey: string;
  hasDrive: boolean;
  /** Label waktu upload sukses terakhir (null = belum pernah). */
  uploadedAt: string | null;
}) {
  const [state, action, pending] = useActionState<GDriveActionState, FormData>(
    uploadDailyReportToDriveAction,
    undefined,
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {uploadedAt && !state?.success ? (
        <span className="text-[12px] text-success">✓ Drive {uploadedAt}</span>
      ) : null}
      <form action={action} className="inline">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="dateKey" value={dateKey} />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          loading={pending}
          disabled={!hasDrive}
          title={hasDrive ? undefined : "Paket belum punya folder Google Drive (atur di halaman paket)."}
        >
          <HardDriveUpload aria-hidden className="size-3.5" /> {uploadedAt ? "Upload ulang Drive" : "Upload Drive"}
        </Button>
      </form>
      {state?.error ? <span className="text-[12px] text-danger">{state.error}</span> : null}
      {state?.success ? <span className="text-[12px] text-success">{state.success}</span> : null}
    </span>
  );
}
