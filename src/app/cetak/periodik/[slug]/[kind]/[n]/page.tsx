import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { ScurveKkpSheet } from "@/components/knmp/scurve-kkp-sheet";
import { KkpPeriodReport } from "@/components/knmp/kkp-period-report";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPeriodReport, type PeriodKind } from "@/lib/periodic-report";

export const dynamic = "force-dynamic";

/** Cetak laporan mingguan/bulanan format KKP — tanpa shell aplikasi. */
export default async function CetakPeriodikPage({
  params,
}: {
  params: Promise<{ slug: string; kind: string; n: string }>;
}) {
  const { slug, kind, n } = await params;
  if (kind !== "mingguan" && kind !== "bulanan") notFound();
  const periodN = Number.parseInt(n, 10);
  if (!Number.isInteger(periodN) || periodN < 1) notFound();

  const user = await requireUser();
  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const report = await getPeriodReport(location.id, kind as PeriodKind, periodN);
  if (!report) notFound();

  return (
    <>
      <PrintToolbar backHref={`/lokasi/${slug}/laporan-lokasi`} />
      {/* Landscape utk halaman Kurva-S; tetap A4 potrait utk tabel detail. */}
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } }`}</style>
      <main className="bg-white">
        {/* Hal-1: KURVA S (landscape) */}
        <section className="mx-auto w-full max-w-[1400px] break-after-page p-6 print:p-0">
          <ScurveKkpSheet r={report} />
        </section>
        {/* Hal-2+: tabel detail item */}
        <section className="mx-auto w-full max-w-[1100px] p-6 print:p-0">
          <KkpPeriodReport r={report} />
        </section>
      </main>
    </>
  );
}
