import { z } from "zod";
import { STAGE_ORDER, TYPES_BY_STAGE } from "@/lib/documents";
import type { DocumentStage } from "@prisma/client";

const STAGES = STAGE_ORDER as [string, ...string[]];
const ALL_TYPES = Array.from(
  new Set(Object.values(TYPES_BY_STAGE).flat())
) as [string, ...string[]];

export const uploadDocumentSchema = z.object({
  stage: z.enum(STAGES, { message: "Tahap tidak valid" }),
  type: z.enum(ALL_TYPES, { message: "Jenis dokumen tidak valid" }),
  title: z.string().trim().min(1, "Judul wajib diisi").max(200),
  docNumber: z.string().trim().max(100).optional().or(z.literal("")),
  docDate: z.coerce.date().optional().or(z.literal("")),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
});

/** Validasi type sesuai stage-nya. */
export function isTypeValidForStage(stage: string, type: string): boolean {
  const types = TYPES_BY_STAGE[stage as DocumentStage];
  return types ? types.includes(type as never) : false;
}

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function validateFile(mime: string, bytes: number): string | null {
  if (bytes > MAX_BYTES) return "Ukuran file maksimal 15 MB.";
  if (!ALLOWED_MIME.includes(mime))
    return "Tipe file tidak didukung (PDF, gambar, Word, atau Excel).";
  return null;
}
