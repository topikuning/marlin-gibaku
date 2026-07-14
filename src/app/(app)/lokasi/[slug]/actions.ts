"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess, ForbiddenError } from "@/lib/auth/session";
import { canTransitionLocation, LOCATION_STATUS_LABEL } from "@/lib/lifecycle";
import type { LocationStatus } from "@/generated/prisma/enums";

export type StatusActionState = { error?: string; success?: string } | undefined;

const LOCATION_STATUSES = Object.keys(LOCATION_STATUS_LABEL) as [LocationStatus, ...LocationStatus[]];

const changeStatusSchema = z.object({
  locationId: z.uuid(),
  toStatus: z.enum(LOCATION_STATUSES),
  note: z.string().trim().max(500).optional(),
});

/** Ubah status lifecycle lokasi: validasi mesin transisi + histori + audit. */
export async function changeLocationStatus(
  _prev: StatusActionState,
  formData: FormData,
): Promise<StatusActionState> {
  const parsed = changeStatusSchema.safeParse({
    locationId: formData.get("locationId"),
    toStatus: formData.get("toStatus"),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("location.manage");
    await requireLocationAccess(user, d.locationId);
    const location = await db.location.findUniqueOrThrow({
      where: { id: d.locationId },
      select: { id: true, slug: true, status: true },
    });
    if (!canTransitionLocation(location.status, d.toStatus)) {
      return {
        error: `Transisi ${LOCATION_STATUS_LABEL[location.status]} → ${LOCATION_STATUS_LABEL[d.toStatus]} tidak diizinkan.`,
      };
    }

    await db.$transaction(async (tx) => {
      await tx.location.update({
        where: { id: location.id },
        data: {
          status: d.toStatus,
          // isActive = tampil di dashboard operasional: nyala saat mulai
          // berjalan, mati saat batal. Status lain tidak menyentuhnya.
          ...(d.toStatus === "berjalan" ? { isActive: true } : {}),
          ...(d.toStatus === "batal" ? { isActive: false } : {}),
        },
      });
      await tx.locationStatusHistory.create({
        data: {
          locationId: location.id,
          fromStatus: location.status,
          toStatus: d.toStatus,
          changedById: user.id,
          note: d.note ?? null,
        },
      });
    });
    await audit(user.id, "location.status_change", "location", location.id, {
      from: location.status,
      to: d.toStatus,
      note: d.note ?? null,
    });

    revalidatePath(`/lokasi/${location.slug}`, "layout");
    revalidatePath("/lokasi");
    revalidatePath("/");
    return { success: `Status lokasi → ${LOCATION_STATUS_LABEL[d.toStatus]}.` };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}
