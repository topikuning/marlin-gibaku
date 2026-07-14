import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { can, isCrossLocation, type Capability } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

export const SESSION_COOKIE = "marlin_session";

/** Durasi sesi per role (detik). */
const ROLE_SESSION_SECONDS: Record<UserRole, number> = {
  site_manager: 30 * 24 * 3600,
  field_supervisor: 30 * 24 * 3600,
  project_manager: 7 * 24 * 3600,
  regional_manager: 7 * 24 * 3600,
  super_admin: 24 * 3600,
  program_director: 24 * 3600,
  exec_viewer: 24 * 3600,
};

export type SessionUser = {
  id: string;
  orgId: string;
  fullName: string;
  username: string | null;
  email: string | null;
  role: UserRole;
  mustChangePassword: boolean;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, role: UserRole, ip?: string, userAgent?: string) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } });
  const expiresAt = new Date(Date.now() + ROLE_SESSION_SECONDS[role] * 1000);
  await db.session.create({
    data: { id: hashToken(token), userId, tokenVersion: user.tokenVersion, expiresAt, ip, userAgent },
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.APP_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({
      where: { id: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Revoke SEMUA sesi user (deactivate / ganti password / force logout). */
export async function revokeAllSessions(userId: string) {
  await db.$transaction([
    db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
  ]);
}

/** User saat ini (di-cache per request). null bila tidak login/expired/revoked. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          orgId: true,
          fullName: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
          mustChangePassword: true,
          tokenVersion: true,
        },
      },
    },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;
  if (session.tokenVersion !== session.user.tokenVersion) return null;
  const { user } = session;
  return {
    id: user.id,
    orgId: user.orgId,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/masuk");
  if (user.mustChangePassword) redirect("/ganti-password");
  return user;
}

export class ForbiddenError extends Error {
  constructor(message = "Tidak punya izin untuk aksi ini") {
    super(message);
  }
}

export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, capability)) throw new ForbiddenError();
  return user;
}

/** Cek akses lokasi: cross-location roles bebas; lainnya wajib assignment aktif. */
export async function hasLocationAccess(user: SessionUser, locationId: string): Promise<boolean> {
  if (isCrossLocation(user.role)) return true;
  const assignment = await db.locationAssignment.findFirst({
    where: { userId: user.id, locationId, unassignedAt: null },
    select: { id: true },
  });
  return assignment !== null;
}

export async function requireLocationAccess(user: SessionUser, locationId: string): Promise<void> {
  if (!(await hasLocationAccess(user, locationId))) throw new ForbiddenError("Tidak punya akses ke lokasi ini");
}

/** Daftar id lokasi yang boleh diakses user. null = semua. */
export async function accessibleLocationIds(user: SessionUser): Promise<string[] | null> {
  if (isCrossLocation(user.role)) return null;
  const rows = await db.locationAssignment.findMany({
    where: { userId: user.id, unassignedAt: null },
    select: { locationId: true },
  });
  return rows.map((r) => r.locationId);
}

export async function requestIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}
