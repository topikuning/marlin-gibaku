import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { ScurveKkpSheet } from "@/components/knmp/scurve-kkp-sheet";
import { KkpPeriodReport } from "@/components/knmp/kkp-period-report";
import { KkpProgresKategori } from "@/components/knmp/kkp-progres-kategori";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPeriodReport, type PeriodKind } from "@/lib/periodic-report";
import { PRINT_BACK_PARAM, safeBackPath } from "@/lib/print-back";
import { muatTtdLaporan } from "@/lib/export/ttd-laporan";
import { alamatLogoLaporan } from "@/lib/export/logo-laporan";
import { can } from "@/lib/authz";
import { alamatPdf } from "@/lib/cetak/alamat-pdf";
import { PARAM_CETAK, cetakOtomatisDiminta } from "@/lib/cetak/mode-cetak";

export const dynamic = "force-dynamic";

/** Cetak laporan mingguan/bulanan format KKP — tanpa shell aplikasi. */
export default async function CetakPeriodikPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; kind: string; n: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, kind, n } = await params;
  const sp = await searchParams;
  if (kind !== "mingguan" && kind !== "bulanan") notFound();
  const periodN = Number.parseInt(n, 10);
  if (!Number.isInteger(periodN) || periodN < 1) notFound();

  const user = await requireUser();
  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);
  // `kind` menentukan penanda tangannya: mingguan diteken Pelaksana Lapangan,
  // bulanan diteken Direktur (DECISIONS 402).
  const [ttd, logo] = await Promise.all([
    muatTtdLaporan(location.id, kind as PeriodKind),
    kind === "mingguan" ? alamatLogoLaporan(location.id) : Promise.resolve(null),
  ]);

  const report = await getPeriodReport(location.id, kind as PeriodKind, periodN);
  if (!report) notFound();

  return (
    <>
      <PrintToolbar
        backHref={safeBackPath(
          typeof sp[PRINT_BACK_PARAM] === "string" ? sp[PRINT_BACK_PARAM] : undefined,
          `/lokasi/${slug}/laporan-lokasi`,
        )}
        pdfHref={can(user.role, "report.export") ? alamatPdf.periodik(slug, kind, periodN) : null}
        cetakOtomatis={cetakOtomatisDiminta(sp[PARAM_CETAK])}
      />
      {/* Landscape utk halaman Kurva-S; tetap A4 potrait utk tabel detail. */}
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } }`}</style>
      <main className="bg-white">
        {/* Dokumen fixed-layout: di layar sempit di-scroll horizontal per section
            (overflow-x-auto), print tetap utuh (print:overflow-visible). */}
        {/* Hal-1: KURVA S (landscape) */}
        <section className="mx-auto w-full max-w-[1400px] break-after-page overflow-x-auto p-6 print:overflow-visible print:p-0">
          {/* Bagian DARI laporan periodik – ikut penanda tangan laporannya
              (DECISIONS 403), bukan penanda tangan dokumen jadwal. */}
          <ScurveKkpSheet r={report} ttd={ttd} jenis={kind as PeriodKind} />
        </section>
        {/* Laporan mingguan: progres per kategori & sub-kategori – format
            Lampiran Termin (DECISIONS 670). */}
        {kind === "mingguan" ? (
          <section className="mx-auto w-full max-w-[1400px] break-after-page overflow-x-auto p-6 print:overflow-visible print:p-0">
            <KkpProgresKategori r={report} ttd={ttd} logo={logo} />
          </section>
        ) : null}
        {/* Hal-berikutnya: tabel detail item */}
        <section className="mx-auto w-full max-w-[1100px] overflow-x-auto p-6 print:overflow-visible print:p-0">
          <KkpPeriodReport r={report} ttd={ttd} />
        </section>
      </main>
    </>
  );
}
