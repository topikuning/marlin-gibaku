import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { KkpWeeklyPlan } from "@/components/knmp/kkp-weekly-plan";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getRencanaMingguan } from "@/lib/plan/rencana-mingguan";
import { PRINT_BACK_PARAM, safeBackPath } from "@/lib/print-back";
import { muatTtdLaporan } from "@/lib/export/ttd-laporan";

export const dynamic = "force-dynamic";

/** Cetak formulir Rencana Kerja Mingguan (A4 potrait) — tanpa shell aplikasi. */
export default async function CetakRencanaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; n: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, n } = await params;
  const sp = await searchParams;
  const minggu = Number.parseInt(n, 10);
  if (!Number.isInteger(minggu) || minggu < 1) notFound();

  const user = await requireUser();
  const location = await db.location.findUnique({ where: { slug }, select: { id: true } });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);
  const ttd = await muatTtdLaporan(location.id);

  const rencana = await getRencanaMingguan(location.id, minggu);
  if (!rencana) notFound();

  return (
    <>
      <PrintToolbar
        backHref={safeBackPath(
          typeof sp[PRINT_BACK_PARAM] === "string" ? sp[PRINT_BACK_PARAM] : undefined,
          // `bagian=rencana` WAJIB ikut: sejak halaman RAB bersub-tab
          // (DECISIONS 362), tanpa itu tombol Kembali mendarat di pohon RAB —
          // bukan di rencana minggu yang barusan dicetak.
          `/lokasi/${slug}/rab?bagian=rencana&minggu=${minggu}`,
        )}
      />
      <style>{`@media print { @page { size: A4 portrait; margin: 12mm; } }`}</style>
      <main className="bg-white">
        {/* Dokumen fixed-layout: di layar sempit di-scroll horizontal,
            saat dicetak tetap utuh. */}
        <section className="mx-auto w-full max-w-[860px] overflow-x-auto p-6 print:overflow-visible print:p-0">
          <KkpWeeklyPlan r={rencana} ttd={ttd} />
        </section>
      </main>
    </>
  );
}
