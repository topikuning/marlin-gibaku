import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDailyReportView } from "@/lib/daily-report-view";
import { KkpDailyReport } from "@/components/knmp/kkp-daily-report";
import { AutoPrint } from "./auto-print";

/** Halaman cetak bersih — TANPA shell app (sidebar/nav). Khusus untuk print/PDF A4. */
export default async function CetakHarianPage({
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

  return (
    <div className="min-h-screen bg-white p-6 text-slate-900 print:p-0">
      <style>{`@page { size: A4; margin: 12mm; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <AutoPrint />
      <KkpDailyReport d={view.data} />
    </div>
  );
}
