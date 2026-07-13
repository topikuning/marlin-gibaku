import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation, canViewDashboard, ROLE_LABEL } from "@/lib/roles";
import { canReport } from "@/lib/report";
import { getLocationProgress } from "@/lib/progress";
import { getPortfolioExtras, forecast } from "@/lib/dashboard";
import { formatRupiahShort } from "@/lib/format";
import { KinerjaGrid } from "./kinerja-grid";

const dtFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const pctFmt = (n: number) => `${n.toFixed(1)}%`;

type LocRow = {
  id: string;
  slug: string;
  name: string;
  province: string;
  contract: { startDate: Date; contractValue: bigint };
};

async function accessibleLocations(userId: string, cross: boolean): Promise<LocRow[]> {
  const sel = {
    id: true,
    slug: true,
    name: true,
    province: true,
    contract: { select: { startDate: true, contractValue: true } },
  };
  if (cross) {
    return db.location.findMany({ orderBy: [{ province: "asc" }, { name: "asc" }], select: sel });
  }
  const rows = await db.userLocationAssignment.findMany({
    where: { userId, unassignedAt: null },
    include: { location: { select: sel } },
    orderBy: { assignedAt: "asc" },
  });
  return rows.map((r) => r.location);
}

/** Status proyek ala command-center (warna hanya untuk status). */
function statusOf(planPct: number, deviationPct: number): { key: string; label: string; dot: string; pill: string } {
  if (planPct <= 0.01) return { key: "abu", label: "Belum Mulai", dot: "#94A3B8", pill: "bg-slate-100 text-slate-500" };
  if (deviationPct >= -1) return { key: "hijau", label: "Sesuai", dot: "#16A34A", pill: "bg-[#DCFCE7] text-[#15803D]" };
  if (deviationPct >= -10) return { key: "kuning", label: "Perhatian", dot: "#D97706", pill: "bg-[#FEF3C7] text-[#B45309]" };
  return { key: "merah", label: "Kritis", dot: "#DC2626", pill: "bg-[#FEE2E2] text-[#DC2626]" };
}

export default async function BerandaPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id, name, role } = session.user;

  const cross = isCrossLocation(role);
  const locations = await accessibleLocations(id, cross);

  if (!canViewDashboard(role)) {
    return (
      <>
        <h1 className="mb-1 text-2xl font-bold text-slate-900">Halo, {name}.</h1>
        <p className="mb-6 text-sm text-slate-500">
          Masuk sebagai <span className="font-medium text-slate-700">{ROLE_LABEL[role]}</span> · {locations.length} lokasi ditugaskan
        </p>
        <ReporterHome locations={locations} canLapor={canReport(role)} />
      </>
    );
  }

  return <CommandCenter locations={locations} />;
}

/* ---------- Command Center (dashboard roles) ---------- */

async function CommandCenter({ locations }: { locations: LocRow[] }) {
  const rows = await Promise.all(
    locations.map(async (loc) => ({
      loc,
      progress: await getLocationProgress(loc.id, loc.contract.startDate),
      status: null as ReturnType<typeof statusOf> | null,
    }))
  );
  for (const r of rows) r.status = statusOf(r.progress.planPct, r.progress.deviationPct);

  const extras = await getPortfolioExtras(locations.map((l) => ({ id: l.id, name: l.name })));

  const totalContract = rows.reduce((s, r) => s + r.loc.contract.contractValue, 0n);
  const totalGrand = rows.reduce((s, r) => s + r.progress.grandTotal, 0n);
  const totalRealized = rows.reduce((s, r) => s + r.progress.realizedValue, 0n);
  const avgRealizedPct = totalGrand > 0n ? (Number(totalRealized) / Number(totalGrand)) * 100 : 0;
  const avgPlanPct =
    rows.length > 0 ? rows.reduce((s, r) => s + r.progress.planPct, 0) / rows.length : 0;
  const dist = { hijau: 0, kuning: 0, merah: 0, abu: 0 } as Record<string, number>;
  for (const r of rows) dist[r.status!.key]++;
  const bermasalah = dist.kuning + dist.merah;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Portfolio Command Center</h1>
        <p className="text-sm text-slate-500">Ringkasan kinerja seluruh proyek</p>
      </div>

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Total Lokasi" value={rows.length.toLocaleString("id-ID")} sub={`${dist.hijau + dist.kuning + dist.merah} berjalan · ${dist.abu} belum`} />
        <Kpi label="Nilai Kontrak" value={formatRupiahShort(totalContract)} />
        <Kpi label="Nilai RAB (HPS)" value={formatRupiahShort(totalGrand)} />
        <Kpi label="Realisasi Fisik" value={pctFmt(avgRealizedPct)} sub={`Rencana ${pctFmt(avgPlanPct)}`} accent />
        <Kpi label="Nilai Terpasang" value={formatRupiahShort(totalRealized)} />
        <Kpi label="Proyek Bermasalah" value={bermasalah.toLocaleString("id-ID")} sub={`${dist.merah} kritis · ${dist.kuning} perhatian`} status={bermasalah > 0 ? "warn" : "ok"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Kinerja proyek */}
        <section className="lg:col-span-2">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Kinerja Proyek</div>
          <KinerjaGrid
            rows={rows.map(({ loc, progress, status }) => {
              const fc = forecast(progress.realizedPct, progress.weekNumber, progress.totalWeeks);
              return {
                id: loc.id,
                slug: loc.slug,
                name: loc.name,
                province: loc.province,
                weekNumber: progress.weekNumber,
                totalWeeks: progress.totalWeeks,
                realizedPct: progress.realizedPct,
                planPct: progress.planPct,
                deviationPct: progress.deviationPct,
                statusLabel: status!.label,
                statusPill: status!.pill,
                forecastLabel: fc.label,
                forecastLate: !!fc.delayWeeks && fc.delayWeeks > 0,
              };
            })}
          />
        </section>

        {/* Right column */}
        <section className="space-y-6">
          <div>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Perlu Tindakan</div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              <ActionRow label="Persetujuan tertunda" n={extras.pendingCount} href="/laporan" tone={extras.pendingCount > 0 ? "warn" : "ok"} />
              <ActionRow label="Proyek kritis" n={dist.merah} tone={dist.merah > 0 ? "bad" : "ok"} />
              <ActionRow label="Proyek perhatian" n={dist.kuning} tone={dist.kuning > 0 ? "warn" : "ok"} />
              <ActionRow label="Belum mulai" n={dist.abu} tone="muted" />
            </div>
          </div>

          <div>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Distribusi Status</div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 text-3xl font-bold tabular-nums text-slate-900">
                {rows.length}<span className="ml-1 text-sm font-medium text-slate-400">total</span>
              </div>
              <ul className="space-y-2 text-sm">
                <DistRow color="#16A34A" label="Sesuai" n={dist.hijau} total={rows.length} />
                <DistRow color="#D97706" label="Perhatian" n={dist.kuning} total={rows.length} />
                <DistRow color="#DC2626" label="Kritis" n={dist.merah} total={rows.length} />
                <DistRow color="#94A3B8" label="Belum Mulai" n={dist.abu} total={rows.length} />
              </ul>
            </div>
          </div>

          <div>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Aktivitas Terakhir</div>
            <div className="rounded-lg border border-slate-200 bg-white">
              {extras.recent.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-400">Belum ada aktivitas.</p>
              ) : (
                extras.recent.map((a) => (
                  <div key={a.id} className="border-b border-slate-100 px-4 py-2.5 last:border-0">
                    <div className="text-sm text-slate-900">
                      <span className="font-medium">{a.by}</span> · {a.volume} {a.unit}
                    </div>
                    <div className="truncate text-xs text-slate-500">{a.itemName}</div>
                    <div className="text-[11px] text-slate-400">{a.locationName} · {dtFmt.format(a.at)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function ActionRow({ label, n, href, tone }: { label: string; n: number; href?: string; tone: "ok" | "warn" | "bad" | "muted" }) {
  const badge =
    tone === "bad" ? "bg-[#FEE2E2] text-[#DC2626]" : tone === "warn" ? "bg-[#FEF3C7] text-[#B45309]" : tone === "ok" ? "bg-[#DCFCE7] text-[#15803D]" : "bg-slate-100 text-slate-500";
  const inner = (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-slate-700">{label}</span>
      <span className={`min-w-[28px] rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums ${badge}`}>{n}</span>
    </div>
  );
  return href ? <Link href={href} className="block hover:bg-slate-50">{inner}</Link> : inner;
}

function DistRow({ color, label, n, total }: { color: string; label: string; n: number; total: number }) {
  const pct = total > 0 ? (n / total) * 100 : 0;
  return (
    <li className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="flex-1 text-slate-600">{label}</span>
      <span className="font-medium tabular-nums text-slate-900">{n}</span>
      <span className="w-12 text-right text-xs tabular-nums text-slate-400">{pct.toFixed(0)}%</span>
    </li>
  );
}

/* ---------- Reporter home ---------- */

function ReporterHome({
  locations,
  canLapor,
}: {
  locations: { id: string; slug: string; name: string; province: string }[];
  canLapor: boolean;
}) {
  return (
    <>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Lokasi Anda</div>
      {locations.length === 0 ? (
        <p className="text-sm text-slate-500">Belum ada lokasi yang ditugaskan. Hubungi admin.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {locations.map((loc) => (
            <div key={loc.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <Link href={`/lokasi/${loc.slug}`} className="font-medium text-slate-900 hover:text-[#1e3a8a]">{loc.name}</Link>
              <div className="mb-3 text-xs text-slate-500">{loc.province}</div>
              {canLapor && (
                <Link href={`/lokasi/${loc.slug}/lapor`} className="inline-block rounded-md bg-[#1e3a8a] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#172554]">
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

function Kpi({ label, value, sub, accent, status }: { label: string; value: string; sub?: string; accent?: boolean; status?: "ok" | "warn" }) {
  const valColor = status === "warn" ? "text-[#DC2626]" : accent ? "text-[#1e3a8a]" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${valColor}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">{sub}</div>}
    </div>
  );
}

