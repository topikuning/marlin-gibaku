import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "./login-form";

export default async function MasukPage() {
  const session = await auth();
  if (session?.user) redirect("/beranda");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      {/* aksen marine di latar */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-teal-50 via-slate-50 to-slate-50" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-teal-200/40 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[#0F766E] text-2xl font-bold text-white shadow-lg shadow-teal-900/20">
            M
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Masuk ke MARLIN
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Monitoring proyek Kampung Nelayan Merah Putih
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Belum punya akses? Hubungi admin program.
        </p>
      </div>
    </main>
  );
}
