import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getBranding } from "@/lib/branding";
import { BrandWordmark } from "@/components/ui/brand-mark";
import { PembersihSimpanan } from "@/components/pwa/pembersih-simpanan";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

export default async function MasukPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const brand = await getBranding();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4">
      {/* Sesi berakhir = simpanan halaman ber-sesi dibuang (DECISIONS 397). */}
      <PembersihSimpanan />
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <BrandWordmark tinggi={44} className="mx-auto mb-3" />
          {/* Tagline (kepanjangan MARLIN) = identitas utama global. */}
          <p className="mt-1 text-sm font-medium text-ink">{brand.tagline}</p>
          {/* Konteks proyek = tambahan. */}
          {brand.projectContext ? (
            <p className="mt-0.5 text-xs text-ink-muted">{brand.projectContext}</p>
          ) : null}
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
