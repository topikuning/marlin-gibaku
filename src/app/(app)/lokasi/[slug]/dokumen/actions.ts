"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { DocumentStage, DocumentType } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageDocuments } from "@/lib/documents";
import { hasLocationAccess } from "@/lib/access";
import {
  uploadDocumentSchema,
  isTypeValidForStage,
  validateFile,
} from "@/lib/schemas/document";
import { r2Put, isR2Configured } from "@/lib/r2";

type ActionState = { ok?: string; error?: string };

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export async function uploadDocument(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Sesi berakhir." };
  const { id: userId, role } = session.user;
  if (!canManageDocuments(role)) return { error: "Role Anda tidak bisa unggah dokumen." };

  const locationId = String(formData.get("locationId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!(await hasLocationAccess(userId, role, locationId))) {
    return { error: "Tidak punya akses ke lokasi ini." };
  }

  const parsed = uploadDocumentSchema.safeParse({
    stage: formData.get("stage"),
    type: formData.get("type"),
    title: formData.get("title"),
    docNumber: formData.get("docNumber") ?? undefined,
    docDate: formData.get("docDate") ?? undefined,
    description: formData.get("description") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }
  const d = parsed.data;
  if (!isTypeValidForStage(d.stage, d.type)) {
    return { error: "Jenis dokumen tidak sesuai dengan tahapnya." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "File wajib dipilih." };
  }
  const fileErr = validateFile(file.type, file.size);
  if (fileErr) return { error: fileErr };

  if (!isR2Configured()) {
    return { error: "Penyimpanan (R2) belum dikonfigurasi di server." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const key = `documents/${locationId}/${d.stage}/${randomUUID()}-${safeName(file.name)}`;

  try {
    await r2Put(key, buffer, file.type);
  } catch {
    return { error: "Gagal mengunggah file ke penyimpanan." };
  }

  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { contractId: true },
  });

  await db.document.create({
    data: {
      locationId,
      contractId: location?.contractId ?? null,
      stage: d.stage as DocumentStage,
      type: d.type as DocumentType,
      title: d.title,
      docNumber: d.docNumber || null,
      docDate: d.docDate instanceof Date ? d.docDate : null,
      description: d.description || null,
      r2Key: key,
      fileName: file.name,
      mimeType: file.type,
      bytes: file.size,
      sha256,
      uploadedByUserId: userId,
    },
  });

  revalidatePath(`/lokasi/${slug}/dokumen`);
  return { ok: `Dokumen "${d.title}" tersimpan.` };
}
