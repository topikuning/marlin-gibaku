"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCapability } from "@/lib/auth/session";
import { DocumentError } from "@/lib/documents";
import { ALL_DOC_TYPES } from "@/lib/documents-meta";
import { GDriveError } from "@/lib/gdrive/client";
import {
  commitDriveImport,
  previewDriveImport,
  type DriveImportPreview,
  type DriveImportResult,
} from "@/lib/gdrive/import";
import type { DocumentType } from "@/generated/prisma/enums";

/**
 * Server action impor Drive → Document Center (DECISIONS 184). Pratinjau dipicu
 * tombol (bukan saat halaman dibuka) karena membaca folder KKP butuh puluhan
 * panggilan jaringan; commit membaca ulang metadata tiap berkas dari Drive.
 */

export type PreviewState =
  | { error: string; preview?: undefined; result?: undefined }
  | { error?: undefined; preview: DriveImportPreview; result?: undefined }
  | { error?: undefined; preview?: DriveImportPreview; result: DriveImportResult }
  | undefined;

function pesan(err: unknown): string {
  if (err instanceof DocumentError || err instanceof GDriveError) return err.message;
  return err instanceof Error ? err.message : "Gagal membaca folder Google Drive";
}

export async function previewImportAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const parsed = z.uuid().safeParse(formData.get("packageId"));
  if (!parsed.success) return { error: "ID paket tidak valid" };
  try {
    await requireCapability("document.upload");
    return { preview: await previewDriveImport(parsed.data) };
  } catch (err) {
    return { error: pesan(err) };
  }
}

const selectionSchema = z.object({
  driveFileId: z.string().trim().min(5).max(200),
  type: z.enum(ALL_DOC_TYPES as [DocumentType, ...DocumentType[]]),
  locationId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
  path: z.string().max(400),
});

export async function commitImportAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const packageId = z.uuid().safeParse(formData.get("packageId"));
  if (!packageId.success) return { error: "ID paket tidak valid" };

  // Baris terpilih dikirim sebagai satu JSON: tabel pratinjau bisa panjang dan
  // tiap baris punya jenis + lokasi yang bisa diubah manusia.
  const raw = formData.get("selections");
  if (typeof raw !== "string" || raw.trim() === "") {
    return { error: "Tidak ada berkas yang dipilih." };
  }
  let selections: z.infer<typeof selectionSchema>[];
  try {
    selections = z.array(selectionSchema).min(1).max(200).parse(JSON.parse(raw));
  } catch {
    return { error: "Pilihan berkas tidak terbaca — muat ulang pratinjau lalu coba lagi." };
  }

  try {
    const result = await commitDriveImport(packageId.data, selections);
    revalidatePath("/dokumen-laporan/dokumen");
    revalidatePath(`/proyek/paket/${packageId.data}/dokumen`);
    return { result };
  } catch (err) {
    return { error: pesan(err) };
  }
}
