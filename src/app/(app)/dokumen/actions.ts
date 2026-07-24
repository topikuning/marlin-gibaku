"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ALL_DOC_TYPES,
  ALL_PHASES,
  DocumentError,
  uploadDocument,
} from "@/lib/documents";
import { requireCapability } from "@/lib/auth/session";
import { parseDateKey } from "@/lib/format";
import type { AdminPhase, DocumentType } from "@/generated/prisma/enums";

/** Server action upload dokumen — dipakai /dokumen/upload dan form cepat lokasi. */

export type UploadActionState = { error?: string; success?: string } | undefined;

const optionalUuid = z.union([z.uuid(), z.literal("")]).transform((v) => v || undefined);
const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid"), z.literal("")])
  .transform((v) => (v ? (parseDateKey(v) ?? undefined) : undefined));

const uploadSchema = z.object({
  title: z.string().trim().min(3, "Judul dokumen minimal 3 karakter").max(200, "Judul maksimal 200 karakter"),
  phase: z.enum(ALL_PHASES as [AdminPhase, ...AdminPhase[]]),
  type: z.enum(ALL_DOC_TYPES as [DocumentType, ...DocumentType[]]),
  packageId: optionalUuid,
  locationId: optionalUuid,
  milestoneId: optionalUuid,
  docNumber: z.string().trim().max(120, "Nomor maksimal 120 karakter"),
  docDate: optionalDate,
  expiryDate: optionalDate,
  description: z.string().trim().max(1000, "Keterangan maksimal 1000 karakter"),
  /** Slug lokasi untuk revalidate halaman lokasi (opsional). */
  locationSlug: z.string().max(100),
});

export async function uploadDocumentAction(
  _prev: UploadActionState,
  formData: FormData,
): Promise<UploadActionState> {
  const parsed = uploadSchema.safeParse({
    title: formData.get("title"),
    phase: formData.get("phase"),
    type: formData.get("type"),
    packageId: formData.get("packageId") ?? "",
    locationId: formData.get("locationId") ?? "",
    milestoneId: formData.get("milestoneId") ?? "",
    docNumber: formData.get("docNumber") ?? "",
    docDate: formData.get("docDate") ?? "",
    expiryDate: formData.get("expiryDate") ?? "",
    description: formData.get("description") ?? "",
    locationSlug: formData.get("locationSlug") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "File wajib dipilih" };
  if (!d.packageId && !d.locationId) {
    return { error: "Pilih paket atau lokasi — dokumen harus tertaut minimal ke salah satunya" };
  }

  try {
    const user = await requireCapability("document.upload");
    const doc = await uploadDocument(
      {
        file,
        packageId: d.packageId,
        locationId: d.locationId,
        milestoneId: d.milestoneId,
        phase: d.phase,
        type: d.type,
        title: d.title,
        docNumber: d.docNumber || null,
        docDate: d.docDate ?? null,
        expiryDate: d.expiryDate ?? null,
        description: d.description || null,
      },
      user.id,
    );
    revalidatePath("/dokumen");
    if (d.locationSlug) revalidatePath(`/lokasi/${d.locationSlug}/dokumen`);
    if (d.packageId) revalidatePath(`/paket/${d.packageId}/dokumen`);
    return {
      success: doc.milestoneId
        ? `Dokumen "${doc.title}" diunggah & tertaut ke milestone administrasi.`
        : `Dokumen "${doc.title}" diunggah.`,
    };
  } catch (err) {
    if (err instanceof DocumentError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal mengunggah dokumen" };
  }
}
