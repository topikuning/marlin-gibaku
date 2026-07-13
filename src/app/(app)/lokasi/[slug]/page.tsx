import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation, canManageUsers, LOCATION_STATUS_LABEL, LOCATION_STATUS_CLASS } from "@/lib/roles";
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
  const canManage = canManageUsers(role);

  async function saveDeviation(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user || !canManageUsers(s.user.role)) return;
    await db.location.update({
      where: { id: location!.id },
      data: {
        deviationCause: String(formData.get("deviationCause") ?? "").trim() || null,
        recoveryPlan: String(formData.get("recoveryPlan") ?? "").trim() || null,
      },
    });
    revalidatePath(`/lokasi/${slug}`);
  }

  return (
    <>
      <Link
        href="/lokasi"
        className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline"
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
      <p className="mb-8 text-sm text-[#1e3a8a]">
        {location.village}, {location.regency} · {location.province}
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
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
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
            Kurva-S — rencana vs realisasi
          </div>
          {canManageUsers(role) && (
            <Link
              href={`/lokasi/${location.slug}/kurva-s`}
              className="text-xs font-semibold text-[#1e3a8a] hover:underline"
            >
              Atur kurva-S →
            </Link>
          )}
        </div>
        <ScurveChart series={scurve} />
      </section>

      {/* Manajemen deviasi & recovery */}
      <section className="mt-6 rounded-lg border border-[#E2E8F0] bg-white p-5">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
          Penyebab deviasi & rencana pemulihan
        </div>
        {canManage ? (
          <form action={saveDeviation} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Penyebab deviasi</label>
              <textarea
                name="deviationCause"
                rows={2}
                defaultValue={location.deviationCause ?? ""}
                placeholder="mis. keterlambatan material, cuaca, pembebasan lahan"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Rencana pemulihan (recovery)</label>
              <textarea
                name="recoveryPlan"
                rows={2}
                defaultValue={location.recoveryPlan ?? ""}
                placeholder="mis. tambah 2 grup kerja, kerja lembur, percepat pengadaan"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]"
              />
            </div>
            <button type="submit" className="rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#172554]">
              Simpan
            </button>
          </form>
        ) : location.deviationCause || location.recoveryPlan ? (
          <dl className="space-y-2 text-sm">
            {location.deviationCause && <div><dt className="text-xs font-semibold text-slate-500">Penyebab deviasi</dt><dd className="text-slate-900">{location.deviationCause}</dd></div>}
            {location.recoveryPlan && <div><dt className="text-xs font-semibold text-slate-500">Rencana pemulihan</dt><dd className="text-slate-900">{location.recoveryPlan}</dd></div>}
          </dl>
        ) : (
          <p className="text-sm text-slate-400">Belum diisi.</p>
        )}
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
          className="rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#172554]"
        >
          Lihat RAB lengkap →
        </Link>
        <Link
          href={`/lokasi/${location.slug}/dokumen`}
          className="rounded-md border border-[#1e3a8a] px-4 py-2 text-sm font-semibold text-[#1e3a8a] transition hover:bg-[#F1F5F9]"
        >
          Arsip Dokumen →
        </Link>
        {canReport(role) && (
          <Link
            href={`/lokasi/${location.slug}/lapor`}
            className="rounded-md border border-[#1e3a8a] px-4 py-2 text-sm font-semibold text-[#1e3a8a] transition hover:bg-[#F1F5F9]"
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
