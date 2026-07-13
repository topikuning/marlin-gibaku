import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canManageUsers } from "@/lib/roles";
import { PageHeader } from "@/components/knmp/page-header";
import { DiagnostikClient } from "./diagnostik-client";
import { ResetData } from "./reset-data";

export default async function DiagnostikPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  if (!canManageUsers(session.user.role)) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Diagnostik"
        title="Diagnostik Sistem"
        subtitle="Uji koneksi penyimpanan foto (Cloudflare R2). Kalau data laporan muncul tapi fotonya tidak, jalankan tes ini untuk tahu apakah R2 benar-benar tersambung."
      />

      <section className="rounded-2xl border border-[#E2E8F0] bg-white p-5">
        <div className="mb-3 text-sm font-semibold text-[#0F172A]">Penyimpanan Foto — Cloudflare R2</div>
        <p className="mb-4 text-sm text-[#64748B]">
          Tes ini mengunggah file kecil ke R2, mengambilnya kembali, membuat URL
          tampil, lalu menghapusnya. Tidak menyisakan file.
        </p>
        <DiagnostikClient />
      </section>

      <section className="mt-6 rounded-2xl border border-[#DC2626]/30 bg-[#FEF2F2] p-5">
        <div className="mb-3 text-sm font-semibold text-[#DC2626]">Zona Berbahaya — Kosongkan Data</div>
        <ResetData />
      </section>
    </>
  );
}
