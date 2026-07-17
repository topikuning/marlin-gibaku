"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import {
  requireCapability,
  revokeAllSessions,
  accessibleLocationIds,
  ForbiddenError,
} from "@/lib/auth/session";
import { ALL_ROLES, ROLE_LABEL, can, canCreateRole } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username minimal 3 karakter")
    .max(50)
    .regex(/^[a-z0-9._-]+$/, "Username: huruf kecil, angka, titik, strip"),
  fullName: z.string().trim().min(2, "Nama lengkap wajib").max(120),
  email: z.union([z.email("Email tidak valid"), z.literal("")]).optional(),
  role: z.enum(ALL_ROLES as [string, ...string[]]),
  password: z.string().min(8, "Password minimal 8 karakter").max(255),
  locationIds: z.array(z.uuid()).optional(),
});

export type UserActionState = { error?: string; success?: string } | undefined;

export async function createUser(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  // Pembuatan user berjenjang (PM → SM/Mandor, SM → Mandor). Peran manajemen
  // penuh (user.manage) juga punya user.create.
  const actor = await requireCapability("user.create");
  const parsed = createUserSchema.safeParse({
    username: formData.get("username"),
    fullName: formData.get("fullName"),
    email: formData.get("email") ?? "",
    role: formData.get("role"),
    password: formData.get("password"),
    locationIds: formData.getAll("locationIds").map(String).filter(Boolean),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Hanya boleh membuat peran di bawahnya (server-side, bukan sekadar UI).
  const targetRole = d.role as UserRole;
  if (!canCreateRole(actor.role, targetRole)) {
    return { error: `Anda tidak berwenang membuat akun peran ${ROLE_LABEL[targetRole]}.` };
  }

  // Pembuat terbatas (bukan user.manage): hanya boleh menugaskan lokasi yang
  // dia akses sendiri. Peran manajemen penuh boleh lokasi mana pun.
  let locationIds = d.locationIds ?? [];
  if (!can(actor.role, "user.manage")) {
    const own = await accessibleLocationIds(actor); // null = akses semua
    if (own !== null) {
      const allowed = new Set(own);
      locationIds = locationIds.filter((id) => allowed.has(id));
    }
  }

  const exists = await db.user.findFirst({
    where: { OR: [{ username: d.username }, ...(d.email ? [{ email: d.email.toLowerCase() }] : [])] },
  });
  if (exists) return { error: "Username/email sudah dipakai." };

  const user = await db.user.create({
    data: {
      orgId: actor.orgId,
      username: d.username,
      email: d.email ? d.email.toLowerCase() : null,
      fullName: d.fullName,
      role: targetRole,
      passwordHash: await hashPassword(d.password),
      mustChangePassword: true,
      createdById: actor.id,
    },
  });
  if (locationIds.length) {
    await db.locationAssignment.createMany({
      data: locationIds.map((locationId) => ({ userId: user.id, locationId })),
      skipDuplicates: true,
    });
  }
  await audit(actor.id, "user.create", "user", user.id, { role: targetRole, locations: locationIds.length });
  revalidatePath("/pengguna");
  return { success: `Pengguna ${d.username} (${ROLE_LABEL[targetRole]}) dibuat. Password harus diganti saat login pertama.` };
}

export async function setUserActive(userId: string, isActive: boolean): Promise<void> {
  const actor = await requireCapability("user.manage");
  if (actor.id === userId && !isActive) throw new ForbiddenError("Tidak bisa menonaktifkan akun sendiri");
  await db.user.update({ where: { id: userId }, data: { isActive } });
  if (!isActive) await revokeAllSessions(userId); // sesi langsung mati
  await audit(actor.id, isActive ? "user.activate" : "user.deactivate", "user", userId);
  revalidatePath("/pengguna");
}

export async function resetUserPassword(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const actor = await requireCapability("user.manage");
  const userId = z.uuid().parse(formData.get("userId"));
  const password = z.string().min(8, "Password minimal 8 karakter").safeParse(formData.get("password"));
  if (!password.success) return { error: password.error.issues[0].message };
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password.data), mustChangePassword: true },
  });
  await revokeAllSessions(userId);
  await audit(actor.id, "user.reset_password", "user", userId);
  revalidatePath("/pengguna");
  return { success: "Password direset. Pengguna wajib menggantinya saat login." };
}

export async function setAssignments(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const actor = await requireCapability("user.manage");
  const userId = z.uuid().parse(formData.get("userId"));
  const locationIds = formData.getAll("locationIds").map(String).filter(Boolean);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.locationAssignment.updateMany({
      where: { userId, unassignedAt: null, locationId: { notIn: locationIds } },
      data: { unassignedAt: now },
    });
    for (const locationId of locationIds) {
      await tx.locationAssignment.upsert({
        where: { userId_locationId: { userId, locationId } },
        update: { unassignedAt: null },
        create: { userId, locationId },
      });
    }
  });
  await audit(actor.id, "user.set_assignments", "user", userId, { count: locationIds.length });
  revalidatePath("/pengguna");
  return { success: "Penugasan lokasi diperbarui." };
}
