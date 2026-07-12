import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation, canViewDashboard, ROLE_LABEL } from "@/lib/roles";
import { canReport } from "@/lib/report";
import { getLocationProgress } from "@/lib/progress";
import { formatRupiahShort } from "@/lib/format";

const pctFmt = (n: number) => `${n.toFixed(1)}%`;

/** Lokasi yang bisa diakses user (cross-role: semua; selain itu: yang ditugaskan). */
async function accessibleLocations(userId: string, cross: boolean) {
  if (cross) {
    return db.location.findMany({
      orderBy: [{ province: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        province: true,
        contract: { select: { startDate: true } },
      },
    });
  }
  const rows = await db.userLocationAssignment.findMany({
    where: { userId, unassignedAt: null },
    include: {
      location: {
        select: {
          id: true,
          slug: true,
          name: true,
          province: true,
          contract: { select: { startDate: true } },
        },
      },
    },
    orderBy: { assignedAt: "asc" },
  });
  return rows.map((r) => r.location);
}

export default async function BerandaPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id, name, role } = session.user;

  const cross = isCrossLocation(role);
  const locations = await accessibleLocations(id, cross);

  return (
    <>
      <h1 className="mb-1 text-3xl font-semibold text-[#0F172A]">Halo, {name}.</h1>
      <p className="mb-8 text-sm text-[#0F766E]">
        Masuk sebagai <span className="font-semibold">{ROLE_LABEL[role]}</span> ·{" "}
        {cross
          ? `akses semua lokasi (${locations.length})`
          : `${locations.length} lokasi ditugaskan`}
      </p>

      {canViewDashboard(role) ? (
        <DashboardOverview locations={locations} />
      ) : (
        <ReporterHome locations={locations} canLapor={canReport(role)} />
      )}
    </>
  );
}

/* ---------- Overview (menggantikan menu Dashboard terpisah) ---------- */

async function DashboardOverview({
  locations,
}: {
  locations: {
    id: string;
    slug: string;
    name: string;
    province: string;
    contract: { startDate: Date };
  }[];
}) {
  const rows = await Promise.all(
    locations.map(async (loc) => ({
      loc,
      progress: await getLocationProgress(loc.id, loc.contract.startDate),
    }))
  );

  const totalGrand = rows.reduce((s, r) => s + r.progress.grandTotal, 0n);
  const totalRealized = rows.reduce((s, r) => s + r.progress.realizedValue, 0n);
  const avgRealizedPct =
    totalGrand > 0n ? (Number(totalRealized) / Number(totalGrand)) * 100 : 0;
  const behind = rows.filter((r) => r.progress.deviationPct < -0.01).length;

  return (
    <>
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        Progress proyek — realisasi vs rencana (kurva-S)
      </div>
      <div className="mb-8 grid gap-4 sm:grid-cols-4">
        <Stat label="Lokasi" value={rows.length.toLocaleString("id-ID")} />
        <Stat label="Total nilai" value={formatRupiahShort(totalGrand)} />
        <Stat label="Realisasi" value={formatRupiahShort(totalRealized)} sub={pctFmt(avgRealizedPct)} />
        <Stat label="Di bawah rencana" value={`${behind} lokasi`} tone={behind > 0 ? "warn" : "ok"} />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[#64748B]">Belum ada lokasi.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#FFFFFF] text-left text-[11px] uppercase tracking-wide text-[#64748B]">
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
                const devClass =
                  dev < -0.01 ? "text-[#DC2626]" : dev > 0.01 ? "text-[#16A34A]" : "text-[#64748B]";
                return (
                  <tr key={loc.id} className="border-b border-[#EEF2F6] last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/lokasi/${loc.slug}`} className="font-semibold text-[#0F766E] hover:underline">
                        {loc.name}
                      </Link>
                      <div className="text-xs text-[#64748B]">
                        {loc.province} · minggu {progress.weekNumber}/{progress.totalWeeks}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ProgressBar realized={progress.realizedPct} plan={progress.planPct} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#0F172A]">
                      {pctFmt(progress.realizedPct)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#64748B]">
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
      )}
    </>
  );
}

/* ---------- Home untuk Site Manager / Mandor ---------- */

function ReporterHome({
  locations,
  canLapor,
}: {
  locations: { id: string; slug: string; name: string; province: string }[];
  canLapor: boolean;
}) {
  return (
    <>
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        Lokasi Anda
      </div>
      {locations.length === 0 ? (
        <p className="text-sm text-[#64748B]">
          Belum ada lokasi yang ditugaskan. Hubungi admin untuk penugasan.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {locations.map((loc) => (
            <div key={loc.id} className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-4">
              <Link href={`/lokasi/${loc.slug}`} className="font-semibold text-[#0F172A] hover:underline">
                {loc.name}
              </Link>
              <div className="mb-3 text-xs text-[#64748B]">{loc.province}</div>
              {canLapor && (
                <Link
                  href={`/lokasi/${loc.slug}/lapor`}
                  className="inline-block rounded-md bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#115E59]"
                >
                  Lapor harian + foto →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- primitives ---------- */

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
  const valColor = tone === "warn" ? "text-[#DC2626]" : "text-[#0F172A]";
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${valColor}`}>{value}</div>
      {sub && <div className="text-xs text-[#64748B]">{sub}</div>}
    </div>
  );
}

function ProgressBar({ realized, plan }: { realized: number; plan: number }) {
  const r = Math.min(Math.max(realized, 0), 100);
  const p = Math.min(Math.max(plan, 0), 100);
  return (
    <div className="relative h-3 w-full max-w-[260px] overflow-hidden rounded-full bg-[#F1F5F9]">
      <div className="h-full rounded-full bg-[#0F766E]" style={{ width: `${r}%` }} />
      <div
        className="absolute top-0 h-full w-0.5 bg-[#DC2626]"
        style={{ left: `${p}%` }}
        title={`Rencana ${p.toFixed(1)}%`}
      />
    </div>
  );
}
