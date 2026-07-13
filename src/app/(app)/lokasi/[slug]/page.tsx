import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation, canManageUsers } from "@/lib/roles";
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
  const deviationNotes = await db.deviationNote.findMany({
    where: { locationId: location.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  async function addDeviation(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user || !canManageUsers(s.user.role)) return;
    const cause = String(formData.get("cause") ?? "").trim();
    if (!cause) return;
    const weekRaw = Number(formData.get("weekNo"));
    await db.deviationNote.create({
      data: {
        locationId: location!.id,
        cause,
        recovery: String(formData.get("recovery") ?? "").trim() || null,
        weekNo: Number.isFinite(weekRaw) && weekRaw > 0 ? Math.trunc(weekRaw) : null,
        createdByUserId: s.user.id,
      },
    });
    revalidatePath(`/lokasi/${slug}`);
  }

  return (
    <>
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

      {/* Catatan deviasi & pemulihan — log per waktu */}
      <section className="mt-6 rounded-lg border border-[#E2E8F0] bg-white p-5">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
          Catatan deviasi & pemulihan (riwayat)
        </div>

        {canManage && (
          <form action={addDeviation} className="mb-5 space-y-3 rounded-lg border border-slate-100 bg-slate-50/60 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Penyebab deviasi</label>
                <textarea
                  name="cause"
                  rows={2}
                  required
                  placeholder="mis. keterlambatan material, cuaca, pembebasan lahan"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Minggu ke</label>
                <input
                  name="weekNo"
                  type="number"
                  min={1}
                  placeholder="—"
                  className="w-20 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Rencana pemulihan (recovery)</label>
              <textarea
                name="recovery"
                rows={2}
                placeholder="mis. tambah 2 grup kerja, lembur, percepat pengadaan"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1e3a8a]"
              />
            </div>
            <button type="submit" className="rounded-md bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#172554]">
              Tambah catatan
            </button>
          </form>
        )}

        {deviationNotes.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada catatan deviasi.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {deviationNotes.map((n) => (
              <li key={n.id} className="relative">
                <span className="absolute -left-[23px] top-1 h-3 w-3 rounded-full bg-amber-500" />
                <div className="flex items-baseline gap-2 text-xs text-slate-500">
                  <span>{dateFmt.format(n.createdAt)}</span>
                  {n.weekNo != null && <span className="rounded-full bg-slate-100 px-1.5 py-0.5">Minggu {n.weekNo}</span>}
                </div>
                <div className="mt-1 text-sm text-slate-900">
                  <span className="font-medium text-slate-500">Deviasi:</span> {n.cause}
                </div>
                {n.recovery && (
                  <div className="text-sm text-slate-700">
                    <span className="font-medium text-slate-500">Pemulihan:</span> {n.recovery}
                  </div>
                )}
              </li>
            ))}
          </ol>
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
