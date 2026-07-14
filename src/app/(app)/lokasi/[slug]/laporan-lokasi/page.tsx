import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Printer, Sheet } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { KkpPeriodReport } from "@/components/knmp/kkp-period-report";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getPeriodBounds, getPeriodReport, type PeriodKind } from "@/lib/periodic-report";
import { jakartaDateKey, formatTanggal } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Tab Laporan lokasi: harian final + mingguan/bulanan KKP + export. */
export default async function LaporanLokasiPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ kind?: string; n?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  requireCapabilityPage(user.role, "report.export");
  const location = await db.location.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const bounds = await getPeriodBounds(location.id);
  const kind: PeriodKind = sp.kind === "bulanan" ? "bulanan" : "mingguan";
  const maxN = bounds ? (kind === "mingguan" ? bounds.totalWeeks : bounds.totalMonths) : 0;
  const currentN = bounds ? (kind === "mingguan" ? bounds.currentWeek : bounds.currentMonth) : 1;
  const n = Math.min(Math.max(Number.parseInt(sp.n ?? String(currentN), 10) || currentN, 1), Math.max(maxN, 1));

  const [report, finalReports] = await Promise.all([
    bounds ? getPeriodReport(location.id, kind, n) : Promise.resolve(null),
    db.dailyReport.findMany({
      where: { locationId: location.id, status: "final" },
      orderBy: { reportDate: "desc" },
      take: 30,
      select: { id: true, reportDate: true, _count: { select: { items: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Laporan Periodik KKP" subtitle="Mingguan / bulanan — dihitung dari laporan harian terkirim (satu calculation layer)." />
        <CardBody className="space-y-4">
          {!bounds ? (
            <EmptyState icon={FileText} title="Kontrak belum ada" description="Laporan periodik butuh periode kontrak." />
          ) : (
            <>
              <form method="GET" className="flex flex-wrap items-end gap-3 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="font-medium">Jenis</span>
                  <select name="kind" defaultValue={kind} className="rounded-md border border-border px-2 py-1.5">
                    <option value="mingguan">Mingguan</option>
                    <option value="bulanan">Bulanan</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium">{kind === "mingguan" ? `Minggu ke (1–${maxN})` : `Bulan ke (1–${maxN})`}</span>
                  <input
                    type="number"
                    name="n"
                    min={1}
                    max={maxN}
                    defaultValue={n}
                    className="w-24 rounded-md border border-border px-2 py-1.5 tabular"
                  />
                </label>
                <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-800">
                  Tampilkan
                </button>
                <span className="grow" />
                <Link
                  href={`/cetak/periodik/${slug}/${kind}/${n}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium hover:bg-surface-muted"
                >
                  <Printer className="h-4 w-4" aria-hidden /> Cetak
                </Link>
                <a
                  href={`/lokasi/${slug}/laporan-lokasi/export?kind=${kind}&n=${n}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium hover:bg-surface-muted"
                >
                  <Sheet className="h-4 w-4" aria-hidden /> Unduh Excel
                </a>
              </form>
              {report ? (
                <div className="overflow-x-auto rounded-md border border-border bg-white p-4">
                  <KkpPeriodReport r={report} />
                </div>
              ) : (
                <EmptyState icon={FileText} title="Periode tidak valid" />
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Laporan harian final" subtitle="Snapshot beku — siap cetak KKP" />
        <CardBody>
          {finalReports.length === 0 ? (
            <EmptyState icon={FileText} title="Belum ada laporan final" description="Finalisasi dilakukan dari workspace harian setelah disetujui." />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {finalReports.map((r) => {
                const key = jakartaDateKey(r.reportDate);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      {formatTanggal(r.reportDate, "EEEE, d MMM yyyy")}
                      <span className="ml-2 text-ink-muted">{r._count.items} item</span>
                    </span>
                    <Link href={`/cetak/harian/${slug}/${key}`} className="font-medium text-primary hover:underline">
                      Cetak
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
