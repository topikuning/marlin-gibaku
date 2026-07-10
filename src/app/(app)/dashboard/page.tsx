import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canViewDashboard, isCrossLocation } from "@/lib/roles";
import { getLocationProgress } from "@/lib/progress";
import { formatRupiahShort } from "@/lib/format";

const pctFmt = (n: number) => `${n.toFixed(1)}%`;

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  if (!canViewDashboard(role)) notFound();

  const locations = isCrossLocation(role)
    ? await db.location.findMany({
        orderBy: [{ province: "asc" }, { name: "asc" }],
        select: { id: true, slug: true, name: true, province: true, contract: { select: { startDate: true } } },
      })
    : (
        await db.userLocationAssignment.findMany({
          where: { userId, unassignedAt: null },
          include: {
            location: {
              select: { id: true, slug: true, name: true, province: true, contract: { select: { startDate: true } } },
            },
          },
          orderBy: { assignedAt: "asc" },
        })
      ).map((a) => a.location);

  const rows = await Promise.all(
    locations.map(async (loc) => ({
      loc,
      progress: await getLocationProgress(loc.id, loc.contract.startDate),
    }))
  );

  const totalGrand = rows.reduce((s, r) => s + r.progress.grandTotal, 0n);
  const totalRealized = rows.reduce((s, r) => s + r.progress.realizedValue, 0n);
  const avgRealizedPct = totalGrand > 0n ? (Number(totalRealized) / Number(totalGrand)) * 100 : 0;
  const behind = rows.filter((r) => r.progress.deviationPct < -0.01).length;

  return (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
        MARLIN · Dashboard
      </div>
      <h1 className="mb-1 font-[Fraunces] text-3xl font-semibold text-[#1f2b38]">
        Progress Proyek
      </h1>
      <p className="mb-8 text-sm text-[#3A4E63]">
        Realisasi vs rencana (kurva-S) untuk {rows.length} lokasi.
      </p>

      <div className="mb-8 grid gap-4 sm:grid-cols-4">
        <Stat label="Lokasi" value={rows.length.toLocaleString("id-ID")} />
        <Stat label="Total nilai" value={formatRupiahShort(totalGrand)} />
        <Stat label="Realisasi" value={formatRupiahShort(totalRealized)} sub={pctFmt(avgRealizedPct)} />
        <Stat label="Di bawah rencana" value={`${behind} lokasi`} tone={behind > 0 ? "warn" : "ok"} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#EAE2D2]">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[#EAE2D2] bg-[#FDFBF6] text-left text-[11px] uppercase tracking-wide text-[#8a9199]">
              <th className="px-4 py-2.5 font-semibold">Lokasi</th>
              <th className="px-4 py-2.5 font-semibold">Progress (realisasi vs rencana)</th>
              <th className="px-4 py-2.5 text-right font-semibold">Realisasi</th>
              <th className="px-4 py-2.5 text-right font-semibold">Rencana</th>
              <th className="px-4 py-2.5 text-right font-semibold">Deviasi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ loc, progress }) => {
              const dev = progress.deviationPct;
              const devClass = dev < -0.01 ? "text-[#C1442E]" : dev > 0.01 ? "text-[#2E7D4F]" : "text-[#8a9199]";
              return (
                <tr key={loc.id} className="border-b border-[#F0EADD] last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/lokasi/${loc.slug}`} className="font-semibold text-[#3A4E63] hover:underline">
                      {loc.name}
                    </Link>
                    <div className="text-xs text-[#8a9199]">
                      {loc.province} · minggu {progress.weekNumber}/{progress.totalWeeks}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <ProgressBar realized={progress.realizedPct} plan={progress.planPct} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#1f2b38]">
                    {pctFmt(progress.realizedPct)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#8a9199]">
                    {pctFmt(progress.planPct)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${devClass}`}>
                    {dev >= 0 ? "+" : ""}
                    {dev.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn";
}) {
  const valColor = tone === "warn" ? "text-[#C1442E]" : "text-[#1f2b38]";
  return (
    <div className="rounded-lg border border-[#EAE2D2] bg-[#FDFBF6] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#3A4E63]">
        {label}
      </div>
      <div className={`mt-1 font-[Fraunces] text-2xl font-semibold ${valColor}`}>{value}</div>
      {sub && <div className="text-xs text-[#8a9199]">{sub}</div>}
    </div>
  );
}

function ProgressBar({ realized, plan }: { realized: number; plan: number }) {
  const r = Math.min(Math.max(realized, 0), 100);
  const p = Math.min(Math.max(plan, 0), 100);
  return (
    <div className="relative h-3 w-full max-w-[260px] overflow-hidden rounded-full bg-[#EFE9DB]">
      <div className="h-full rounded-full bg-[#3A4E63]" style={{ width: `${r}%` }} />
      {/* penanda target rencana */}
      <div
        className="absolute top-0 h-full w-0.5 bg-[#C1442E]"
        style={{ left: `${p}%` }}
        title={`Rencana ${p.toFixed(1)}%`}
      />
    </div>
  );
}
