import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canApprove } from "@/lib/report";
import { getDailyReportView } from "@/lib/daily-report-view";
import { KkpDailyReport } from "@/components/knmp/kkp-daily-report";
import { PageHeader } from "@/components/knmp/page-header";
import { DailyLogEditor } from "./editor";

export default async function LaporanHarianKkpPage({
  params,
}: {
  params: Promise<{ slug: string; date: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  const { slug, date } = await params;

  const view = await getDailyReportView(slug, date, userId, role);
  if (view === "notfound" || view === "forbidden") notFound();

  const canEdit = canApprove(role);

  return (
    <>
      <Link href={`/lokasi/${slug}`} className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline">
        ← Detail Lokasi
      </Link>
      <PageHeader
        eyebrow="Laporan Harian KKP"
        title={`Laporan Harian — ${view.locationName}`}
        subtitle="Format resmi KKP. Mandor input ringkas; Site Manager melengkapi tenaga per keahlian, material, peralatan, dan cuaca di sini."
      />

      {/* Navigasi tanggal + cetak */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-2" action={`/lokasi/${slug}/harian`}>
          <label className="text-sm text-slate-500">Tanggal:</label>
          <input
            type="date"
            name="d"
            defaultValue={date}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#1e3a8a]"
          />
          <button className="rounded-md border border-[#1e3a8a] px-3 py-1.5 text-sm font-medium text-[#1e3a8a] hover:bg-[#F1F5F9]">
            Buka
          </button>
        </form>
        <Link
          href={`/cetak/harian/${slug}/${date}`}
          target="_blank"
          className="ml-auto rounded-md bg-[#1e3a8a] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[#172554]"
        >
          Cetak / PDF →
        </Link>
      </div>

      {/* Preview form KKP */}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
        <KkpDailyReport d={view.data} />
      </section>

      {/* Editor SM */}
      {canEdit ? (
        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">
            Lengkapi Laporan Harian (Site Manager)
          </h2>
          <DailyLogEditor slug={slug} date={date} initial={view.editor} />
        </section>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          Detail dilengkapi oleh Site Manager. Klik “Cetak / PDF” untuk mengunduh laporan.
        </p>
      )}
    </>
  );
}
