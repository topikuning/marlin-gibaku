import type { MilestoneStatus } from "@/generated/prisma/enums";

/**
 * Status milestone SETELAH dokumen bukti diunggah inline (DECISIONS 091).
 * Aturan "auto-maju + bisa override" (pilihan user):
 * - Bila user mengubah dropdown status (submitted ≠ current) → HORMATI pilihan itu.
 * - Bila item sudah "selesai"/"tidak_berlaku" → jangan mundur.
 * - Selain itu dokumen memajukan status: butuh verifikasi → "berjalan" (menunggu
 *   verifikasi manusia), selain itu → "selesai".
 * Fungsi murni (tanpa DB) supaya bisa diuji unit.
 */
export function statusAfterUpload(
  current: MilestoneStatus,
  submitted: MilestoneStatus,
  requiresVerification: boolean,
): MilestoneStatus {
  if (submitted !== current) return submitted; // override manual
  if (current === "selesai" || current === "tidak_berlaku") return current;
  return requiresVerification ? "berjalan" : "selesai";
}
