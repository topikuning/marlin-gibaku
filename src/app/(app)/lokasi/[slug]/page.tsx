import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation, LOCATION_STATUS_LABEL, LOCATION_STATUS_CLASS } from "@/lib/roles";
import { canReport } from "@/lib/report";
import { formatRupiah } from "@/lib/format";
import { getScurveSeries } from "@/lib/scurve-data";
import { ScurveChart } from "@/components/knmp/scurve-chart";

const dateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });

export default async function LokasiDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id, role } = session.user;
  const { slug } = await params;

  const location = await db.location.findUnique({
    where: { slug },
    include: {
      contract: { include: { contractor: true } },
      categories: {
        where: { revision: { status: "active" } },
        orderBy: { sortOrder: "asc" },
        select: { id: true, romanNumeral: true, name: true, totalValue: true },
      },
    },
  });
  if (!location) notFound();

  // Scoped role hanya boleh lihat lokasi yang ditugaskan.
  if (!isCrossLocation(role)) {
    const assigned = await db.userLocationAssignment.findFirst({
      where: { userId: id, locationId: location.id, unassignedAt: null },
    });
    if (!assigned) notFound();
  }

  const grandTotal = location.categories.reduce(
    (sum, c) => sum + c.totalValue,
    0n
  );

  const c = location.contract;
  const scurve = await getScurveSeries(location.id, c.startDate);

  return (
    <>
      <Link
        href="/lokasi"
        className="mb-4 inline-block text-sm text-[#0F766E] hover:underline"
      >
        ← Daftar Lokasi
      </Link>

      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-3xl font-semibold text-[#0F172A]">
          {location.name}
        </h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${LOCATION_STATUS_CLASS[location.status]}`}
        >
          {LOCATION_STATUS_LABEL[location.status]}
        </span>
      </div>
      <p className="mb-8 text-sm text-[#0F766E]">
        {location.village}, {location.regency} · {location.province}
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
            Kontrak
          </div>
          <dl className="space-y-2 text-sm">
            <Row label="Nomor SPK" value={c.contractNumber} />
            <Row label="Kontraktor" value={c.contractor.name} />
            <Row label="Nilai Kontrak" value={formatRupiah(c.contractValue)} />
            <Row label="Mulai" value={dateFmt.format(c.startDate)} />
            <Row label="Selesai" value={dateFmt.format(c.endDate)} />
          </dl>
        </section>

        <section className="rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
            Ringkasan RAB ({location.categories.length} kategori aktif)
          </div>
          <div className="text-2xl font-semibold text-[#0F172A]">
            {formatRupiah(grandTotal)}
          </div>
          <p className="mt-1 text-xs text-[#64748B]">
            Grand total = SUM kategori aktif (DECISIONS 014).
          </p>
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
          Kurva-S — rencana vs realisasi
        </div>
        <ScurveChart series={scurve} />
      </section>

      <section className="mt-6 overflow-x-auto rounded-lg border border-[#E2E8F0]">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#FFFFFF] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
              <th className="px-4 py-2.5 font-semibold">#</th>
              <th className="px-4 py-2.5 font-semibold">Kategori Pekerjaan</th>
              <th className="px-4 py-2.5 text-right font-semibold">Nilai</th>
            </tr>
          </thead>
          <tbody>
            {location.categories.map((cat) => (
              <tr
                key={cat.id}
                className="border-b border-[#EEF2F6] last:border-0"
              >
                <td className="px-4 py-2.5 text-[#64748B]">{cat.romanNumeral}</td>
                <td className="px-4 py-2.5 text-[#0F172A]">{cat.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#0F172A]">
                  {formatRupiah(cat.totalValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-4 flex items-center gap-4">
        <Link
          href={`/lokasi/${location.slug}/rab`}
          className="rounded-md bg-[#0F766E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#115E59]"
        >
          Lihat RAB lengkap →
        </Link>
        <Link
          href={`/lokasi/${location.slug}/dokumen`}
          className="rounded-md border border-[#0F766E] px-4 py-2 text-sm font-semibold text-[#0F766E] transition hover:bg-[#F1F5F9]"
        >
          Arsip Dokumen →
        </Link>
        {canReport(role) && (
          <Link
            href={`/lokasi/${location.slug}/lapor`}
            className="rounded-md border border-[#0F766E] px-4 py-2 text-sm font-semibold text-[#0F766E] transition hover:bg-[#F1F5F9]"
          >
            Lapor Harian →
          </Link>
        )}
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[#64748B]">{label}</dt>
      <dd className="text-right font-medium text-[#0F172A]">{value}</dd>
    </div>
  );
}
