import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPeriodReport, type PeriodKind } from "@/lib/periodic-report";
import { KkpPeriodReport } from "@/components/knmp/kkp-period-report";

export default async function LaporanPeriodikPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ kind?: string; n?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  const { slug } = await params;
  const sp = await searchParams;

  const kind: PeriodKind = sp.kind === "bulanan" ? "bulanan" : "mingguan";
  const n = Math.max(1, Number(sp.n) || 1);

  const report = await getPeriodReport(slug, kind, n, userId, role);
  if (report === "notfound" || report === "forbidden") notFound();

  const total = kind === "mingguan" ? report.totalWeeks : report.totalMonths;

  return (
    <>
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <form className="flex flex-wrap items-end gap-2" action={`/lokasi/${slug}/periodik`}>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Jenis</label>
            <select name="kind" defaultValue={kind} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#1e3a8a]">
              <option value="mingguan">Mingguan</option>
              <option value="bulanan">Bulanan</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">{kind === "mingguan" ? "Minggu ke" : "Bulan ke"}</label>
            <input name="n" type="number" min={1} defaultValue={n} className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#1e3a8a]" />
          </div>
          <button className="rounded-md border border-[#1e3a8a] px-3 py-1.5 text-sm font-medium text-[#1e3a8a] hover:bg-[#F1F5F9]">Tampilkan</button>
          <span className="pb-1.5 text-xs text-slate-400">dari {total} {kind === "mingguan" ? "minggu" : "bulan"}</span>
        </form>
        <Link
          href={`/cetak/periodik/${slug}/${kind}/${n}`}
          target="_blank"
          className="ml-auto rounded-md bg-[#1e3a8a] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[#172554]"
        >
          Cetak / PDF →
        </Link>
      </div>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5">
        <KkpPeriodReport r={report} />
      </section>
    </>
  );
}
