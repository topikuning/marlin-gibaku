import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { ScurveKkpSheet } from "@/components/knmp/scurve-kkp-sheet";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPeriodBounds, getPeriodReport } from "@/lib/periodic-report";

export const dynamic = "force-dynamic";

/**
 * Cetak JADWAL (Time Schedule / Kurva-S) berdiri sendiri — format seperti time
 * schedule sipil: baris kategori × minggu (bobot), kumulatif rencana + realisasi,
 * garis kurva-S. Snapshot s/d minggu berjalan; periode = seluruh masa kontrak.
 * Butuh SPMK (startDate) agar kolom minggu terpetakan ke tanggal/bulan.
 */
export default async function CetakJadwalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const bounds = await getPeriodBounds(location.id);
  if (!bounds) notFound(); // jadwal butuh kontrak + SPMK
  const report = await getPeriodReport(location.id, "mingguan", bounds.currentWeek);
  if (!report) notFound();

  return (
    <>
      <PrintToolbar backHref={`/lokasi/${slug}/progress`} />
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } }`}</style>
      <main className="bg-white">
        <section className="mx-auto w-full max-w-[1400px] overflow-x-auto p-6 print:overflow-visible print:p-0">
          <ScurveKkpSheet
            r={report}
            titleOverride="TIME SCHEDULE (KURVA S) — RENCANA & REALISASI"
            periodeOverride={{ start: bounds.startDate, end: bounds.endDate }}
          />
        </section>
      </main>
    </>
  );
}
