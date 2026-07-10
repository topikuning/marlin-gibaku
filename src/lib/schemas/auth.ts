import { z } from "zod";

/**
 * Login boundary (DECISIONS 019): identifier = username ATAU email, + password.
 * Tidak ada OTP/device-binding di flow ini.
 */
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Username atau email wajib diisi")
    .max(255),
  password: z.string().min(1, "Password wajib diisi").max(255),
});

export type LoginInput = z.infer<typeof loginSchema>;
