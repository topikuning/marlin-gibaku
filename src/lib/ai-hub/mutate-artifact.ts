import "server-only";
import { db } from "@/lib/db";
import { auditIn } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";
import type { AiArtifactStatus } from "@/generated/prisma/enums";

/** Pembacaan di awal request tidak memberi izin menimpa perubahan request lain. */
export async function updateMutableArtifact(
  before: { id: string; status: AiArtifactStatus; updatedAt: Date },
  data: Prisma.AiArtifactUpdateManyMutationInput,
  actorId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const result = await tx.aiArtifact.updateMany({
      where: { id: before.id, status: before.status, updatedAt: before.updatedAt, frozenAt: null },
      data,
    });
    if (result.count !== 1) {
      throw new Error("Laporan ini baru saja berubah atau sudah dibekukan. Muat ulang halaman, lalu coba lagi.");
    }
    await auditIn(tx, actorId, action, "ai_artifact", before.id, payload);
  });
}
