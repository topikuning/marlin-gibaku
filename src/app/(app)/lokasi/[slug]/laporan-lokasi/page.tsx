import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { KkpPeriodReport } from "@/components/knmp/kkp-period-report";
import { ScurveKkpSheet } from "@/components/knmp/scurve-kkp-sheet";
import { PeriodFilter } from "./period-filter";
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
  searchParams: Promise<{ kind?: string; n?: string; show?: string }>;
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
  // Generate eksplisit (audit UX #7): laporan hanya dihitung setelah "Tampilkan".
  const shown = sp.show === "1" && !!bounds;

  const [report, finalReports] = await Promise.all([
    shown ? getPeriodReport(location.id, kind, n) : Promise.resolve(null),
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
              <PeriodFilter slug={slug} kind={kind} n={n} maxN={maxN} shown={shown} />
              {!shown ? (
                <EmptyState
                  icon={FileText}
                  title="Laporan belum ditampilkan"
                  description="Pilih jenis laporan dan periode di atas, lalu klik Tampilkan untuk membuat laporan."
                />
              ) : report ? (
                <div className="space-y-4">
                  {/* Hal-1: KURVA S (grafik) */}
                  <div className="overflow-x-auto rounded-md border border-border bg-white p-4">
                    <ScurveKkpSheet r={report} />
                  </div>
                  {/* Hal-2+: tabel detail item */}
                  <div className="overflow-x-auto rounded-md border border-border bg-white p-4">
                    <KkpPeriodReport r={report} />
                  </div>
                </div>
              ) : (
                <EmptyState icon={FileText} title="Periode tidak valid" description="Periode di luar rentang kontrak." />
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
