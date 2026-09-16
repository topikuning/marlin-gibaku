import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import type { Prisma } from "@/generated/prisma/client";

/** Cakupan lokasi tidak menggantikan kepemilikan organisasi, termasuk admin. */
export async function aiArtifactOrgWhere(user: Pick<SessionUser, "orgId">): Promise<Prisma.AiArtifactWhereInput> {
  const users = await db.user.findMany({ where: { orgId: user.orgId }, select: { id: true } });
  return {
    createdById: { in: users.map((u) => u.id) },
    AND: [
      { OR: [{ packageId: null }, { package: { orgId: user.orgId } }] },
      { OR: [{ runId: null }, { run: { orgId: null } }, { run: { orgId: user.orgId } }] },
    ],
  };
}

/** Run lama memakai pembuatnya; run grup tanpa pembuat memakai orgId nyata. */
export async function aiRunOrgWhere(user: Pick<SessionUser, "orgId">): Promise<Prisma.AiRunWhereInput> {
  const users = await db.user.findMany({ where: { orgId: user.orgId }, select: { id: true } });
  return { OR: [
    { orgId: user.orgId },
    { orgId: null, userId: { in: users.map((u) => u.id) } },
  ] };
}
