"use client";

import { useAksi } from "@/lib/aksi-klien";


import { HardDriveUpload } from "lucide-react";
import { Banner, Button, HelpText, Input, Label } from "@/components/ui";
import { setPackageDriveFolderAction, type GDriveActionState } from "@/lib/gdrive/actions";

/**
 * Atur folder Google Drive paket (pemberian KKP) — tujuan upload PDF/Excel
 * laporan harian & mingguan. Tempel link folder atau ID-nya. DECISIONS 141.
 */
export function DriveFolderForm({
  packageId,
  currentFolderId,
  driveConnected,
}: {
  packageId: string;
  currentFolderId: string | null;
  driveConnected: boolean;
}) {
  const [state, action, pending] = useAksi<GDriveActionState>(
    setPackageDriveFolderAction,
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {!driveConnected ? (
        <Banner
          tone="warning"
          title="Akun Google belum terhubung"
          description="Hubungkan dulu di Sistem → Integrasi → Google Drive; folder tetap bisa disimpan sekarang."
        />
      ) : null}
      <input type="hidden" name="packageId" value={packageId} />
      <div>
        <Label htmlFor="drive-folder">Link / ID folder Drive</Label>
        <Input
          id="drive-folder"
          name="folder"
          defaultValue={currentFolderId ?? ""}
          placeholder="https://drive.google.com/drive/folders/…"
        />
        <HelpText>
          Folder dari KKP untuk paket ini. Akun Google MARLIN harus terdaftar sebagai editor di folder
          tersebut. Kosongkan lalu simpan untuk melepas.
        </HelpText>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          <HardDriveUpload aria-hidden className="size-4" /> Simpan folder
        </Button>
        {currentFolderId ? (
          <a
            href={`https://drive.google.com/drive/folders/${currentFolderId}`}
            target="_blank"
            rel="noopener"
            className="text-[13px] font-medium text-primary hover:underline"
          >
            Buka folder di Drive →
          </a>
        ) : null}
      </div>
    </form>
  );
}
