"use client";

import { useAksi } from "@/lib/aksi-klien";


import { HardDriveUpload } from "lucide-react";
import { Button } from "@/components/ui";
import {
  uploadActivityToDriveAction,
  uploadDocumentToDriveAction,
  type GDriveActionState,
} from "@/lib/gdrive/actions";

/**
 * Tombol upload ke folder KKP di Google Drive — dipakai kegiatan lapangan &
 * dokumen administrasi. Nonaktif dengan alasan jelas bila paket belum punya
 * folder Drive. DECISIONS 143.
 */
function UploadButton({
  action,
  hiddenName,
  hiddenValue,
  label,
  doneLabel,
  hasDrive,
  size = "sm",
}: {
  action: (s: GDriveActionState, f: FormData) => Promise<GDriveActionState>;
  hiddenName: string;
  hiddenValue: string;
  label: string;
  doneLabel: string | null;
  hasDrive: boolean;
  size?: "sm" | "md";
}) {
  const [state, formAction, pending] = useAksi<GDriveActionState>(action, undefined);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {doneLabel && !state?.success ? <span className="text-[12px] text-success">✓ Drive {doneLabel}</span> : null}
      <form action={formAction} className="inline">
        <input type="hidden" name={hiddenName} value={hiddenValue} />
        <Button
          type="submit"
          size={size}
          variant="ghost"
          loading={pending}
          disabled={!hasDrive}
          title={hasDrive ? undefined : "Paket belum punya folder Google Drive (atur di halaman paket)."}
        >
          <HardDriveUpload aria-hidden className="size-3.5" /> {pending ? "Mengupload…" : doneLabel ? `Ulangi ${label.toLowerCase()}` : label}
        </Button>
      </form>
      {state?.error ? <span className="text-[12px] text-danger">{state.error}</span> : null}
      {state?.success ? <span className="text-[12px] text-success">{state.success}</span> : null}
    </span>
  );
}

/** Kegiatan lapangan (PDF + seluruh foto) → 6. DOKUMENTASI. */
export function UploadActivityToDrive({
  activityId,
  hasDrive,
  uploadedAt,
}: {
  activityId: string;
  hasDrive: boolean;
  uploadedAt: string | null;
}) {
  return (
    <UploadButton
      action={uploadActivityToDriveAction}
      hiddenName="activityId"
      hiddenValue={activityId}
      label="Upload Drive"
      doneLabel={uploadedAt}
      hasDrive={hasDrive}
    />
  );
}

/** Dokumen administrasi → folder KKP sesuai jenisnya. */
export function UploadDocumentToDrive({
  documentId,
  hasDrive,
  uploadedAt,
}: {
  documentId: string;
  hasDrive: boolean;
  uploadedAt: string | null;
}) {
  return (
    <UploadButton
      action={uploadDocumentToDriveAction}
      hiddenName="documentId"
      hiddenValue={documentId}
      label="Upload Drive"
      doneLabel={uploadedAt}
      hasDrive={hasDrive}
    />
  );
}
