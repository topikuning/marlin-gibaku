import { z } from "zod";
import { ALL_ROLES } from "@/lib/roles";

const ROLE_VALUES = ALL_ROLES as [string, ...string[]];

/** Provisioning user baru (DECISIONS 019). Login pakai username; email opsional. */
export const createUserSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "Username minimal 3 karakter")
      .max(50)
      .regex(/^[a-z0-9._-]+$/, "Username: huruf kecil, angka, . _ - saja"),
    fullName: z.string().trim().min(1, "Nama wajib diisi").max(120),
    email: z
      .string()
      .trim()
      .email("Email tidak valid")
      .max(255)
      .optional()
      .or(z.literal("")),
    phoneE164: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{8,15}$/, "Nomor HP tidak valid")
      .optional()
      .or(z.literal("")),
    role: z.enum(ROLE_VALUES, { message: "Role tidak valid" }),
    password: z.string().min(8, "Password minimal 8 karakter").max(255),
    locationIds: z.array(z.string().uuid()).default([]),
  })
  .transform((v) => ({
    ...v,
    email: v.email === "" ? undefined : v.email,
    phoneE164: v.phoneE164 === "" ? undefined : v.phoneE164,
  }));

export type CreateUserInput = z.infer<typeof createUserSchema>;
