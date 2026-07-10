"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { hashPassword } from "@/lib/password";
import { createUserSchema } from "@/lib/schemas/user";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

type ActionState = { ok?: string; error?: string };

export async function createUser(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user || !canManageUsers(session.user.role)) {
    return { error: "Tidak berwenang." };
  }

  const parsed = createUserSchema.safeParse({
    username: formData.get("username"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phoneE164: formData.get("phoneE164"),
    role: formData.get("role"),
    password: formData.get("password"),
    locationIds: formData.getAll("locationIds"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid." };
  }
  const data = parsed.data;

  try {
    const passwordHash = await hashPassword(data.password);
    await db.user.create({
      data: {
        orgId: DEFAULT_ORG_ID,
        username: data.username,
        email: data.email,
        phoneE164: data.phoneE164,
        fullName: data.fullName,
        passwordHash,
        role: data.role as UserRole,
        locationAssignments: {
          create: data.locationIds.map((locationId) => ({ locationId })),
        },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.join(", ") ?? "field";
      return { error: `Sudah dipakai: ${target}. Pilih username/email lain.` };
    }
    return { error: "Gagal membuat user." };
  }

  revalidatePath("/pengguna");
  return { ok: `User "${data.username}" dibuat.` };
}

export async function setUserActive(userId: string, isActive: boolean) {
  const session = await auth();
  if (!session?.user || !canManageUsers(session.user.role)) return;
  // Jangan bisa menonaktifkan diri sendiri (hindari lock-out).
  if (session.user.id === userId) return;
  await db.user.update({ where: { id: userId }, data: { isActive } });
  revalidatePath("/pengguna");
}
