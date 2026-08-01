import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { KkpDailyReport } from "@/components/knmp/kkp-daily-report";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getKkpDailyData } from "@/lib/daily-report/queries";
import { parseDateKey } from "@/lib/format";
import { PRINT_BACK_PARAM, safeBackPath } from "@/lib/print-back";

export const dynamic = "force-dynamic";

/** Cetak Laporan Harian format KKP — A4, tanpa shell aplikasi. */
export default async function CetakHarianPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; date: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, date } = await params;
  const sp = await searchParams;
  if (!parseDateKey(date)) notFound();
  const user = await requireUser();
  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const data = await getKkpDailyData(slug, date);
  if (!data) notFound();

  return (
    <>
      <PrintToolbar
        backHref={safeBackPath(
          typeof sp[PRINT_BACK_PARAM] === "string" ? sp[PRINT_BACK_PARAM] : undefined,
          // Cadangan: laporan harian tanggal itu sendiri — BUKAN daftar laporan
          // lokasi (di sana ada laporan mingguan, terasa nyasar).
          `/lokasi/${slug}/harian/${date}`,
        )}
      />
      <main className="mx-auto max-w-[900px] bg-white p-6 print:p-0">
      {!data.isFinal && (
        <p className="no-print mb-3 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm">
          Pratinjau — laporan belum difinalisasi (data live, bukan snapshot).
        </p>
      )}
      {/* Form bergaris fixed-layout: scroll horizontal di layar sempit. */}
      <div className="overflow-x-auto print:overflow-visible">
        <div className="min-w-[720px]">
          <KkpDailyReport d={data} />
        </div>
      </div>
      </main>
    </>
  );
}
