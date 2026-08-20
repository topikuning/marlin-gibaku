import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { ScurveKkpSheet } from "@/components/knmp/scurve-kkp-sheet";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPeriodBounds, getPeriodReport } from "@/lib/periodic-report";
import { formatTanggal } from "@/lib/format";
import { muatTtdLaporan } from "@/lib/export/ttd-laporan";

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
  const ttd = await muatTtdLaporan(location.id);

  // Jadwal tetap tersedia sebelum SPMK: bila startDate belum ada, asumsikan mulai
  // HARI INI (saat jadwal diminta) dari durasi kontrak. Realisasi 0 (belum jalan).
  const bounds = await getPeriodBounds(location.id, { assume: true });
  if (!bounds) notFound(); // butuh kontrak + durasi
  const report = await getPeriodReport(location.id, "mingguan", bounds.currentWeek, { assume: true });
  if (!report) notFound();

  return (
    <>
      <PrintToolbar backHref={`/lokasi/${slug}/progress`} />
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } }`}</style>
      <main className="bg-white">
        <section className="mx-auto w-full max-w-[1400px] overflow-x-auto p-6 print:overflow-visible print:p-0">
          {bounds.assumed ? (
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 print:border-black print:bg-white print:text-black">
              Catatan: SPMK belum diterbitkan. Jadwal ini dihitung dari <b>asumsi mulai {formatTanggal(bounds.startDate)}</b>{" "}
              (durasi kontrak {report.header.masaPelaksanaanHari} hari). Tanggal akan menyesuaikan otomatis setelah SPMK diinput.
            </p>
          ) : null}
          <ScurveKkpSheet
            ttd={ttd}
            r={report}
            titleOverride="TIME SCHEDULE (KURVA S) – RENCANA & REALISASI"
            periodeOverride={{ start: bounds.startDate, end: bounds.endDate }}
          />
        </section>
      </main>
    </>
  );
}
