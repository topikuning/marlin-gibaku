import "server-only";
import { auditIn } from "@/lib/audit";
import { requestIp } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { canTransitionInspection } from "@/lib/lifecycle";

/** Logika inspeksi lapangan pemeriksa (DECISIONS 426). Otorisasi di actions. */

export class InspectionError extends Error {}

export type InspectionInput = {
  locationId: string;
  inspectionDateKey: string;
  title: string;
  notes?: string | null;
  recommendation?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
};

function toDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

export async function createInspection(input: InspectionInput, userId: string): Promise<{ id: string }> {
  const ip = await requestIp();
  return db.$transaction(async (tx) => {
    const row = await tx.inspection.create({
      data: {
        locationId: input.locationId,
        inspectorId: userId,
        inspectionDate: toDate(input.inspectionDateKey),
        title: input.title,
        notes: input.notes ?? null,
        recommendation: input.recommendation ?? null,
        gpsLat: input.gpsLat ?? null,
        gpsLng: input.gpsLng ?? null,
      },
      select: { id: true },
    });
    await auditIn(tx, userId, "inspection.create", "inspection", row.id, { locationId: input.locationId }, ip);
    return row;
  });
}

export async function updateInspection(
  id: string,
  patch: Pick<InspectionInput, "title" | "notes" | "recommendation"> & { inspectionDateKey?: string },
  userId: string,
): Promise<void> {
  const row = await db.inspection.findUnique({ where: { id }, select: { status: true, inspectorId: true } });
  if (!row) throw new InspectionError("Inspeksi tidak ditemukan.");
  if (row.status !== "draft") throw new InspectionError("Inspeksi final tidak bisa diubah lagi.");
  if (row.inspectorId !== userId) {
    // Catatan inspeksi adalah kesaksian pemeriksanya — orang lain tidak
    // menulis ulang kesaksian orang.
    throw new InspectionError("Hanya pemeriksanya sendiri yang bisa mengubah draft inspeksi ini.");
  }
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    await tx.inspection.update({
      where: { id },
      data: {
        title: patch.title,
        notes: patch.notes ?? null,
        recommendation: patch.recommendation ?? null,
        ...(patch.inspectionDateKey ? { inspectionDate: toDate(patch.inspectionDateKey) } : {}),
      },
    });
    await auditIn(tx, userId, "inspection.update", "inspection", id, {}, ip);
  });
}

export async function finalizeInspection(id: string, userId: string): Promise<void> {
  const row = await db.inspection.findUnique({ where: { id }, select: { status: true, inspectorId: true } });
  if (!row) throw new InspectionError("Inspeksi tidak ditemukan.");
  if (!canTransitionInspection(row.status, "final")) throw new InspectionError("Inspeksi ini sudah final.");
  if (row.inspectorId !== userId) throw new InspectionError("Hanya pemeriksanya sendiri yang bisa memfinalkan.");
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    const updated = await tx.inspection.updateMany({
      where: { id, status: "draft" },
      data: { status: "final", finalizedAt: new Date() },
    });
    if (updated.count !== 1) throw new InspectionError("Inspeksi berubah di tengah jalan – muat ulang.");
    await auditIn(tx, userId, "inspection.finalize", "inspection", id, {}, ip);
  });
}
