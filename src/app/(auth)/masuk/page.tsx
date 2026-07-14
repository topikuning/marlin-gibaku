import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

export default async function MasukPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold tracking-tight text-primary">
            MARLIN
            <span className="ml-1 inline-block h-2 w-2 rounded-full bg-brand-red align-middle" />
          </div>
          <p className="mt-1 text-sm text-ink-muted">Pengendalian Proyek Kampung Nelayan Merah Putih</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
