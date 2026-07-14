import { notFound } from "next/navigation";
import { AutoPrint } from "@/components/print/auto-print";
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
    <main className="mx-auto max-w-[1100px] bg-white p-6 print:p-0">
      <AutoPrint />
      <KkpPeriodReport r={report} />
    </main>
  );
}
