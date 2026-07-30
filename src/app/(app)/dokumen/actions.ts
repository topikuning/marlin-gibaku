"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ALL_DOC_TYPES,
  ALL_PHASES,
  DocumentError,
  uploadDocument,
} from "@/lib/documents";
import {
  deleteDocumentPermanently,
  restoreDocument,
  updateDocumentMeta,
  voidDocument,
} from "@/lib/documents-manage";
import { requireCapability } from "@/lib/auth/session";
import { parseDateKey } from "@/lib/format";
import type { AdminPhase, DocumentType } from "@/generated/prisma/enums";

/**
 * Server action dokumen: upload (dipakai /dokumen/upload & form cepat lokasi)
 * serta siklus hidup koreksi/batalkan/pulihkan/hapus permanen.
 */

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
  amendmentId: optionalUuid,
  contractId: optionalUuid,
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
    amendmentId: formData.get("amendmentId") ?? "",
    contractId: formData.get("contractId") ?? "",
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
        amendmentId: d.amendmentId,
        contractId: d.contractId,
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
    if (d.amendmentId && d.packageId) revalidatePath(`/paket/${d.packageId}/kontrak`);
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

// ─── Siklus hidup dokumen: koreksi / batalkan / pulihkan / hapus ─────
//
// Semua guard (capability, akses lokasi, acuan RAB/pengeluaran, efek milestone,
// audit dalam transaksi) ada di lib/documents-manage.ts — action di sini hanya
// memvalidasi FormData dan mengurus revalidate. DECISIONS 183.

const lifecycleTargets = z.object({
  documentId: z.uuid("ID dokumen tidak valid"),
  /** Untuk revalidate halaman terkait — bukan dipakai sebagai otorisasi. */
  locationSlug: z.string().max(100).optional(),
  packageId: z.union([z.uuid(), z.literal("")]).optional(),
});

function revalidateDocument(t: { documentId: string; locationSlug?: string; packageId?: string }): void {
  revalidatePath("/dokumen");
  revalidatePath(`/dokumen/${t.documentId}`);
  if (t.locationSlug) revalidatePath(`/lokasi/${t.locationSlug}/dokumen`);
  if (t.packageId) {
    revalidatePath(`/paket/${t.packageId}/dokumen`);
    revalidatePath(`/paket/${t.packageId}/administrasi`);
  }
}

const editSchema = lifecycleTargets.extend({
  title: z
    .string()
    .trim()
    .min(3, "Judul dokumen minimal 3 karakter")
    .max(200, "Judul maksimal 200 karakter"),
  phase: z.enum(ALL_PHASES as [AdminPhase, ...AdminPhase[]]),
  type: z.enum(ALL_DOC_TYPES as [DocumentType, ...DocumentType[]]),
  docNumber: z.string().trim().max(120, "Nomor maksimal 120 karakter"),
  docDate: optionalDate,
  expiryDate: optionalDate,
  description: z.string().trim().max(1000, "Keterangan maksimal 1000 karakter"),
});

export async function updateDocumentAction(
  _prev: UploadActionState,
  formData: FormData,
): Promise<UploadActionState> {
  const parsed = editSchema.safeParse({
    documentId: formData.get("documentId"),
    locationSlug: formData.get("locationSlug") ?? undefined,
    packageId: formData.get("packageId") ?? "",
    title: formData.get("title"),
    phase: formData.get("phase"),
    type: formData.get("type"),
    docNumber: formData.get("docNumber") ?? "",
    docDate: formData.get("docDate") ?? "",
    expiryDate: formData.get("expiryDate") ?? "",
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const { changed } = await updateDocumentMeta(d.documentId, {
      title: d.title,
      phase: d.phase,
      type: d.type,
      docNumber: d.docNumber || null,
      docDate: d.docDate ?? null,
      expiryDate: d.expiryDate ?? null,
      description: d.description || null,
    });
    revalidateDocument(d);
    return {
      success:
        changed.length === 0
          ? "Tidak ada yang berubah."
          : `Dokumen diperbarui (${changed.length} kolom). Perubahan tercatat di audit.`,
    };
  } catch (err) {
    if (err instanceof DocumentError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal memperbarui dokumen" };
  }
}

const voidSchema = lifecycleTargets.extend({
  reason: z
    .string()
    .trim()
    .min(5, "Alasan pembatalan wajib diisi (minimal 5 karakter)")
    .max(500, "Alasan maksimal 500 karakter"),
});

export async function voidDocumentAction(
  _prev: UploadActionState,
  formData: FormData,
): Promise<UploadActionState> {
  const parsed = voidSchema.safeParse({
    documentId: formData.get("documentId"),
    locationSlug: formData.get("locationSlug") ?? undefined,
    packageId: formData.get("packageId") ?? "",
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const { title } = await voidDocument(parsed.data.documentId, parsed.data.reason);
    revalidateDocument(parsed.data);
    return {
      success: `Dokumen "${title}" dibatalkan — hilang dari daftar & tidak lagi dihitung sebagai bukti milestone. Masih bisa dipulihkan.`,
    };
  } catch (err) {
    if (err instanceof DocumentError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal membatalkan dokumen" };
  }
}

export async function restoreDocumentAction(
  _prev: UploadActionState,
  formData: FormData,
): Promise<UploadActionState> {
  const parsed = lifecycleTargets.safeParse({
    documentId: formData.get("documentId"),
    locationSlug: formData.get("locationSlug") ?? undefined,
    packageId: formData.get("packageId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const { title } = await restoreDocument(parsed.data.documentId);
    revalidateDocument(parsed.data);
    return {
      success: `Dokumen "${title}" dipulihkan. Status milestone TIDAK ikut dihidupkan otomatis — periksa halaman Administrasi bila dokumen ini buktinya.`,
    };
  } catch (err) {
    if (err instanceof DocumentError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal memulihkan dokumen" };
  }
}

const deleteSchema = lifecycleTargets.extend({
  /** Pengaman ketik-ulang — hapus permanen tidak boleh sekali klik. */
  confirm: z.string().trim(),
});

export async function deleteDocumentAction(
  _prev: UploadActionState,
  formData: FormData,
): Promise<UploadActionState> {
  const parsed = deleteSchema.safeParse({
    documentId: formData.get("documentId"),
    locationSlug: formData.get("locationSlug") ?? undefined,
    packageId: formData.get("packageId") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.confirm.toUpperCase() !== "HAPUS PERMANEN") {
    return { error: 'Ketik "HAPUS PERMANEN" untuk mengonfirmasi.' };
  }

  try {
    const { title, storageWarning } = await deleteDocumentPermanently(parsed.data.documentId);
    revalidateDocument(parsed.data);
    return {
      success: storageWarning
        ? `Dokumen "${title}" dihapus permanen. ${storageWarning}`
        : `Dokumen "${title}" dihapus permanen — baris & file tidak bisa dipulihkan.`,
    };
  } catch (err) {
    if (err instanceof DocumentError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menghapus dokumen" };
  }
}
