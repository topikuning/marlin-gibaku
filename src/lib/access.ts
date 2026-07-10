import type { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";

/** Cross-location role lihat semua; selain itu harus punya assignment aktif. */
export async function hasLocationAccess(
  userId: string,
  role: UserRole,
  locationId: string
): Promise<boolean> {
  if (isCrossLocation(role)) return true;
  const assignment = await db.userLocationAssignment.findFirst({
    where: { userId, locationId, unassignedAt: null },
  });
  return assignment !== null;
}
