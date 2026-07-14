"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  destroySession,
  getCurrentUser,
  revokeAllSessions,
  requestIp,
} from "@/lib/auth/session";
import { audit } from "@/lib/audit";

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Isi username atau email").max(255),
  password: z.string().min(1, "Isi password").max(255),
});

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_FAILED = 5;

export type LoginState = { error?: string } | undefined;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { identifier, password } = parsed.data;
  const ip = (await requestIp()) ?? "unknown";

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const failed = await db.loginAttempt.count({
    where: { identifier: identifier.toLowerCase(), ip, success: false, createdAt: { gte: since } },
  });
  if (failed >= RATE_LIMIT_MAX_FAILED) {
    return { error: "Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit." };
  }

  const user = await db.user.findFirst({
    where: {
      isActive: true,
      OR: [{ username: identifier }, { email: identifier.toLowerCase() }],
    },
  });
  const ok = user ? await verifyPassword(user.passwordHash, password) : false;
  await db.loginAttempt.create({
    data: { identifier: identifier.toLowerCase(), ip, success: ok },
  });
  if (!user || !ok) return { error: "Username/email atau password salah." };

  const h = await headers();
  await createSession(user.id, user.role, ip, h.get("user-agent") ?? undefined);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(user.id, "user.login", "user", user.id);

  redirect(user.mustChangePassword ? "/ganti-password" : "/");
}

export async function logout() {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit(user.id, "user.logout", "user", user.id);
  redirect("/masuk");
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Isi password sekarang"),
    newPassword: z.string().min(8, "Password baru minimal 8 karakter").max(255),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Konfirmasi password tidak sama",
    path: ["confirmPassword"],
  });

export type ChangePasswordState = { error?: string } | undefined;

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await getCurrentUser();
  if (!user) redirect("/masuk");
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const dbUser = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  const ok = await verifyPassword(dbUser.passwordHash, parsed.data.currentPassword);
  if (!ok) return { error: "Password sekarang salah." };
  if (parsed.data.newPassword === parsed.data.currentPassword) {
    return { error: "Password baru harus berbeda dari password lama." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword), mustChangePassword: false },
  });
  await revokeAllSessions(user.id);
  await audit(user.id, "user.change_password", "user", user.id);

  const h = await headers();
  await createSession(user.id, dbUser.role, await requestIp(), h.get("user-agent") ?? undefined);
  redirect("/");
}
