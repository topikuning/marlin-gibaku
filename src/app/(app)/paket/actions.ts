"use server";

import { revalidatePath } from "next/cache";
import type { ProcurementStage } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { hasLocationAccess } from "@/lib/access";
import { canSetStage, PROC_STAGES } from "@/lib/procurement";

type ActionState = { ok?: string; error?: string };

export async function setStage(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user || !canSetStage(session.user.role))
    return { error: "Tidak berwenang." };

  const locationId = String(formData.get("locationId") ?? "");
  const stage = String(formData.get("stage") ?? "") as ProcurementStage;
  if (!PROC_STAGES.includes(stage)) return { error: "Tahap tidak valid." };
  if (!(await hasLocationAccess(session.user.id, session.user.role, locationId)))
    return { error: "Tidak punya akses ke lokasi ini." };

  await db.location.update({ where: { id: locationId }, data: { procurementStage: stage } });
  revalidatePath("/paket");
  return { ok: "Tahap diperbarui." };
}
