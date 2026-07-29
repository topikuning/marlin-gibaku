"use client";

import { useRef, useState, useTransition } from "react";
import { Paperclip } from "lucide-react";
import { uploadDocumentAction, type UploadActionState } from "@/app/(app)/dokumen/actions";

/**
 * Lampirkan dokumen CCO langsung dari baris riwayat adendum — pilih file,
 * langsung terunggah (judul otomatis dari nomor CCO), tanpa pindah halaman.
 */
export function AmendmentDocUpload({
  packageId,
  contractId,
  amendmentId,
  ccoNumber,
}: {
  packageId: string;
  contractId: string;
  amendmentId: string;
  ccoNumber: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadActionState>(undefined);
  const [pending, startTransition] = useTransition();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const f = new FormData();
    f.append("file", file);
    f.append("title", `Dokumen adendum ${ccoNumber}`);
    f.append("phase", "adendum");
    f.append("type", "adendum");
    f.append("packageId", packageId);
    f.append("contractId", contractId);
    f.append("amendmentId", amendmentId);
    f.append("docNumber", ccoNumber);
    startTransition(() => {
      void uploadDocumentAction(undefined, f).then(setState);
    });
  };

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline disabled:opacity-50"
        title={`Unggah dokumen ${ccoNumber}`}
      >
        <Paperclip aria-hidden className="size-3.5" />
        {pending ? "Mengunggah..." : "Lampirkan"}
      </button>
      {state?.error ? <span className="text-[11px] text-danger">{state.error}</span> : null}
    </span>
  );
}
