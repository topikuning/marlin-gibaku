import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "./login-form";

export default async function MasukPage() {
  const session = await auth();
  if (session?.user) redirect("/beranda");

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
            MARLIN · Monitoring KNMP
          </div>
          <h1 className="font-[Fraunces] text-3xl font-semibold text-[#1f2b38]">
            Masuk
          </h1>
          <p className="mt-2 text-sm text-[#3A4E63]">
            Gunakan username atau email dan password Anda.
          </p>
        </div>

        <div className="rounded-lg border border-[#EAE2D2] bg-[#FDFBF6] p-6 shadow-sm">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-[#8a9199]">
          Belum punya akses? Hubungi admin program.
        </p>
      </div>
    </main>
  );
}
