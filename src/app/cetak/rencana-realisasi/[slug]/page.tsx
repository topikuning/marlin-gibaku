import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { KkpRencanaRealisasi } from "@/components/knmp/kkp-rencana-realisasi";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPeriodBounds, getPeriodReport } from "@/lib/periodic-report";
import { formatTanggal } from "@/lib/format";
import { muatTtdLaporan } from "@/lib/export/ttd-laporan";
import { PRINT_BACK_PARAM, safeBackPath } from "@/lib/print-back";
import { can } from "@/lib/authz";
import { alamatPdf } from "@/lib/cetak/alamat-pdf";
import { PARAM_CETAK, cetakOtomatisDiminta } from "@/lib/cetak/mode-cetak";

export const dynamic = "force-dynamic";

/**
 * Cetak LAPORAN RENCANA & REALISASI MINGGUAN PER KATEGORI (DECISIONS 674) –
 * seluruh masa kontrak, posisi s/d minggu berjalan. Data sama dengan Time
 * Schedule: snapshot `getPeriodReport` minggu berjalan.
 */
export default async function CetakRencanaRealisasiPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const bounds = await getPeriodBounds(location.id, { assume: true });
  if (!bounds) notFound();
  const [report, ttd] = await Promise.all([
    getPeriodReport(location.id, "mingguan", bounds.currentWeek, { assume: true }),
    muatTtdLaporan(location.id, "mingguan"),
  ]);
  if (!report) notFound();

  return (
    <>
      <PrintToolbar
        backHref={safeBackPath(
          typeof sp[PRINT_BACK_PARAM] === "string" ? sp[PRINT_BACK_PARAM] : undefined,
          `/lokasi/${slug}/laporan-lokasi`,
        )}
        pdfHref={can(user.role, "report.export") ? alamatPdf.rencanaRealisasi(slug) : null}
        cetakOtomatis={cetakOtomatisDiminta(sp[PARAM_CETAK])}
      />
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } }`}</style>
      <main className="bg-white">
        <section className="mx-auto w-full max-w-[1400px] overflow-x-auto p-6 print:overflow-visible print:p-0">
          {bounds.assumed ? (
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 print:border-black print:bg-white print:text-black">
              Catatan: SPMK belum diterbitkan. Minggu dihitung dari <b>asumsi mulai {formatTanggal(bounds.startDate)}</b>{" "}
              (durasi kontrak {report.header.masaPelaksanaanHari} hari), jadi realisasinya masih kosong.
            </p>
          ) : null}
          <KkpRencanaRealisasi r={report} ttd={ttd} />
        </section>
      </main>
    </>
  );
}
