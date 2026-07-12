import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canManageUsers } from "@/lib/roles";
import { DiagnostikClient } from "./diagnostik-client";

export default async function DiagnostikPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  if (!canManageUsers(session.user.role)) notFound();

  return (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        MARLIN · Diagnostik
      </div>
      <h1 className="mb-1 text-3xl font-semibold text-[#0F172A]">Diagnostik Sistem</h1>
      <p className="mb-8 text-sm text-[#0F766E]">
        Uji koneksi penyimpanan foto (Cloudflare R2). Kalau data laporan muncul tapi
        fotonya tidak, jalankan tes ini untuk tahu apakah R2 benar-benar tersambung.
      </p>

      <section className="rounded-2xl border border-[#E2E8F0] bg-white p-5">
        <div className="mb-3 text-sm font-semibold text-[#0F172A]">Penyimpanan Foto — Cloudflare R2</div>
        <p className="mb-4 text-sm text-[#64748B]">
          Tes ini mengunggah file kecil ke R2, mengambilnya kembali, membuat URL
          tampil, lalu menghapusnya. Tidak menyisakan file.
        </p>
        <DiagnostikClient />
      </section>
    </>
  );
}
