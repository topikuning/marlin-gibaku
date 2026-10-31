"use client";

import Link from "next/link";
import { ExternalLink, FolderUp } from "lucide-react";
import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, buttonClass } from "@/components/ui";
import { siapkanBerkasTerminAction, type PenagihanState } from "@/lib/penagihan/actions";

/** Tombol "Siapkan berkas Termin n" (DECISIONS 721). */
export function SiapkanBerkasTermin({
  packageId,
  terminKe,
  ulang,
  folderDrive,
}: {
  packageId: string;
  terminKe: number;
  /** Sudah pernah disiapkan: labelnya "Siapkan ulang". */
  ulang: boolean;
  /** Alamat folder Drive paket, bila ada. */
  folderDrive: string | null;
}) {
  const [state, action, pending] = useAksi<PenagihanState>(siapkanBerkasTerminAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="packageId" value={packageId} />
      <input type="hidden" name="terminKe" value={terminKe} />
      {state?.error ? (
        <Banner
          tone="error"
          title={state.error}
          action={
            state.tautan ? (
              <Link href={state.tautan.href} className={buttonClass("secondary", "sm")}>
                {state.tautan.teks}
              </Link>
            ) : undefined
          }
        />
      ) : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={pending}>
          <FolderUp aria-hidden className="size-4" />
          {ulang ? `Siapkan ulang berkas Termin ${terminKe}` : `Siapkan berkas Termin ${terminKe}`}
        </Button>
        {folderDrive ? (
          <a href={folderDrive} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
            <ExternalLink aria-hidden className="size-4" />
            Buka folder Drive
          </a>
        ) : null}
      </div>
    </form>
  );
}
