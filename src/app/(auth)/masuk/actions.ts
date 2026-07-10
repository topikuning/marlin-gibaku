"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

/**
 * Server Action login. Return string = pesan error untuk ditampilkan.
 * signIn melempar redirect (NEXT_REDIRECT) saat sukses — harus di-rethrow.
 */
export async function authenticate(
  _prevState: string | undefined,
  formData: FormData
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      identifier: formData.get("identifier"),
      password: formData.get("password"),
      redirectTo: "/beranda",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "Username/email atau password salah.";
    }
    throw error;
  }
}
