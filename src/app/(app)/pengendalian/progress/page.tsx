import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, KpiCard, Card, CardHeader, CardBody, EmptyState, ProgressBar } from "@/components/ui";
import { DeltaBadge, deviationTone } from "@/components/ui/stat-delta";
import { TrendingUp } from "lucide-react";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getLocationsProgress } from "@/lib/progress";
import { weightedPct, weightedRealizedPct } from "@/lib/progress-calc";
import { formatRupiahShort, formatPct } from "@/lib/format";

export const metadata: Metadata = { title: "Progress" };
export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "progress.view");
  const locIds = await accessibleLocationIds(user);

  const locations = await db.location.findMany({
    where: { ...locationScopeWhere(user, locIds), isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      province: true,
      package: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  const progress = await getLocationsProgress(locations.map((l) => l.id));

  let totalRab = 0n;
  let totalRealized = 0n;
  for (const p of progress.values()) {
    totalRab += p.grandTotal;
    totalRealized += p.realizedValue;
  }
  // Formula kanonik (B13) — jangan tulis ulang rata-rata tertimbang di halaman.
  const avgPlan = weightedPct([...progress.values()].map((p) => ({ grandTotal: p.grandTotal, pct: p.planPct })));
  const avgActual = weightedRealizedPct([...progress.values()]);

  const rows = locations
    .map((l) => ({ ...l, p: progress.get(l.id)! }))
    .sort((a, b) => a.p.deviationPct - b.p.deviationPct);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Progress Portfolio"
        description="Rencana vs realisasi berbasis volume — angka dihitung dari RAB aktif, baseline aktif, dan laporan harian terkirim."
        actions={
          can(user.role, "ai.view") ? (
            <Link
              href="/pengendalian/insight"
              className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-muted"
            >
              Buka di AI Intelligence
            </Link>
          ) : null
        }
      />
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Nilai RAB aktif" value={formatRupiahShort(totalRab)} sub="pra-PPN" />
        <KpiCard label="Nilai terpasang" value={formatRupiahShort(totalRealized)} />
        <KpiCard label="Rencana (tertimbang)" value={formatPct(avgPlan)} />
        <KpiCard
          label="Realisasi (tertimbang)"
          value={formatPct(avgActual)}
          tone={deviationTone(avgActual - avgPlan)}
          sub={`deviasi ${formatPct(avgActual - avgPlan)}`}
        />
      </section>
      <Card>
        <CardHeader title="Per lokasi" subtitle="Diurutkan dari deviasi terburuk" />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState icon={TrendingUp} title="Belum ada lokasi aktif" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="py-2 pr-3">Lokasi</th>
                    <th className="py-2 pr-3">Paket</th>
                    <th className="py-2 pr-3">Minggu</th>
                    <th className="py-2 pr-3 text-right">Rencana</th>
                    <th className="py-2 pr-3 text-right">Realisasi</th>
                    <th className="py-2 pr-3">Deviasi</th>
                    <th className="py-2 pr-3 text-right">Terpasang</th>
                    <th className="py-2 w-40">Kurva</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 pr-3">
                        <Link href={`/proyek/lokasi/${l.slug}/progress`} className="font-medium text-primary hover:underline">
                          {l.name}
                        </Link>
                        <div className="text-xs text-ink-muted">{l.province}</div>
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">{l.package.name}</td>
                      <td className="py-2 pr-3 tabular">
                        {l.p.weekNumber}/{l.p.totalWeeks}
                      </td>
                      <td className="py-2 pr-3 text-right tabular">{formatPct(l.p.planPct)}</td>
                      <td className="py-2 pr-3 text-right tabular">{formatPct(l.p.realizedPct)}</td>
                      <td className="py-2 pr-3">
                        <DeltaBadge value={l.p.deviationPct} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular">{formatRupiahShort(l.p.realizedValue)}</td>
                      <td className="py-2">
                        <ProgressBar
                          value={l.p.realizedPct}
                          tone={deviationTone(l.p.deviationPct)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
