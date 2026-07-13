import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canManageProspek } from "@/lib/prospek";
import { PageHeader } from "@/components/knmp/page-header";
import { ProspekForm } from "./prospek-form";

export default async function ProspekBaruPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  if (!canManageProspek(session.user.role)) notFound();

  return (
    <>
      <Link href="/paket" className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline">
        ← Paket
      </Link>
      <PageHeader
        eyebrow="Paket"
        title="Prospek Baru (Calon Kontrak)"
        subtitle="Mulai lacak paket sejak tahap tender. Isi HPS & desa target; saat menang, konversi jadi kontrak dengan nilai final."
      />
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <ProspekForm />
      </section>
    </>
  );
}
