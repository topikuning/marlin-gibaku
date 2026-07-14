import { notFound } from "next/navigation";
import { AutoPrint } from "@/components/print/auto-print";
import { KkpDailyReport } from "@/components/knmp/kkp-daily-report";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getKkpDailyData } from "@/lib/daily-report/queries";
import { parseDateKey } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Cetak Laporan Harian format KKP — A4, tanpa shell aplikasi. */
export default async function CetakHarianPage({
  params,
}: {
  params: Promise<{ slug: string; date: string }>;
}) {
  const { slug, date } = await params;
  if (!parseDateKey(date)) notFound();
  const user = await requireUser();
  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const data = await getKkpDailyData(slug, date);
  if (!data) notFound();

  return (
    <main className="mx-auto max-w-[900px] bg-white p-6 print:p-0">
      <AutoPrint />
      {!data.isFinal && (
        <p className="no-print mb-3 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm">
          Pratinjau — laporan belum difinalisasi (data live, bukan snapshot).
        </p>
      )}
      <KkpDailyReport d={data} />
    </main>
  );
}
