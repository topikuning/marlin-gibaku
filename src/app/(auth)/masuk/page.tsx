import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getBranding } from "@/lib/branding";
import { BrandMark } from "@/components/ui/brand-mark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

export default async function MasukPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const brand = await getBranding();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <BrandMark size={56} className="mx-auto mb-2" />
          <div className="text-2xl font-bold tracking-tight text-primary">{brand.appName}</div>
          {/* Tagline (kepanjangan MARLIN) = identitas utama global. */}
          <p className="mt-1 text-sm font-medium text-ink">{brand.tagline}</p>
          {/* Konteks proyek = tambahan. */}
          <p className="mt-0.5 text-xs text-ink-muted">{brand.projectContext}</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
