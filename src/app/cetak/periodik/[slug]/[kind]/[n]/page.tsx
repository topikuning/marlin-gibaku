import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPeriodReport, type PeriodKind } from "@/lib/periodic-report";
import { KkpPeriodReport } from "@/components/knmp/kkp-period-report";
import { AutoPrint } from "@/components/knmp/auto-print";

export default async function CetakPeriodikPage({
  params,
}: {
  params: Promise<{ slug: string; kind: string; n: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  const { slug, kind, n } = await params;
  if (kind !== "mingguan" && kind !== "bulanan") notFound();

  const report = await getPeriodReport(slug, kind as PeriodKind, Number(n), userId, role);
  if (report === "notfound" || report === "forbidden") notFound();

  return (
    <div className="min-h-screen bg-white p-6 text-slate-900 print:p-0">
      <style>{`@page { size: A4; margin: 12mm; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <AutoPrint />
      <KkpPeriodReport r={report} />
    </div>
  );
}
