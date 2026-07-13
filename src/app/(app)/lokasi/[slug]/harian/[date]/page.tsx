import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canApprove } from "@/lib/report";
import { getDailyReportView } from "@/lib/daily-report-view";
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
      {/* Toolbar: judul section + tanggal + cetak */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Laporan Harian (format KKP)</div>
          <div className="text-xs text-slate-500">Isi datanya di bawah; klik Cetak untuk PDF resmi.</div>
        </div>
        <form className="flex items-center gap-2" action={`/lokasi/${slug}/harian`}>
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

      {/* Input (utama) */}
      {canEdit ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <DailyLogEditor slug={slug} date={date} initial={view.editor} />
        </section>
      ) : (
        <p className="text-sm text-slate-500">
          Detail dilengkapi oleh Site Manager. Klik “Cetak / PDF” untuk laporan resmi.
        </p>
      )}
    </>
  );
}
