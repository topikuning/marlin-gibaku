import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Ganti Password" };

export default async function GantiPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/masuk");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-xl font-bold tracking-tight text-primary">Ganti Password</div>
          <p className="mt-1 text-sm text-ink-muted">
            {user.mustChangePassword
              ? "Demi keamanan, ganti password bawaan sebelum melanjutkan."
              : "Perbarui password akun Anda."}
          </p>
        </div>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
