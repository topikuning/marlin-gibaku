import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, KpiCard, Card, CardHeader, CardBody } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getLocationsProgress } from "@/lib/progress";
import { getLastSubmittedReportDates } from "@/lib/daily-report/queries";
import { weightedPct, weightedRealizedPct } from "@/lib/progress-calc";
import { formatRupiahShort, formatPct, formatTanggal, jakartaToday } from "@/lib/format";
import { ProgressGrid, type ProgressRow } from "./progress-grid";

export const metadata: Metadata = { title: "Progress" };
export const dynamic = "force-dynamic";

/** Sehari dalam milidetik — dua tanggal kerja sama-sama tengah malam UTC. */
const SEHARI_MS = 86_400_000;

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
  const [progress, terakhirLapor] = await Promise.all([
    getLocationsProgress(locations.map((l) => l.id)),
    getLastSubmittedReportDates(locations.map((l) => l.id)),
  ]);

  let totalRab = 0n;
  let totalRealized = 0n;
  for (const p of progress.values()) {
    totalRab += p.grandTotal;
    totalRealized += p.realizedValue;
  }
  // Formula kanonik (B13) — jangan tulis ulang rata-rata tertimbang di halaman.
  const avgPlan = weightedPct([...progress.values()].map((p) => ({ grandTotal: p.grandTotal, pct: p.planPct })));
  const avgActual = weightedRealizedPct([...progress.values()]);

  const hariIni = jakartaToday();
  const rows: ProgressRow[] = locations
    .map((l) => {
      const p = progress.get(l.id)!;
      const lapor = terakhirLapor.get(l.id) ?? null;
      return {
        id: l.id,
        slug: l.slug,
        name: l.name,
        provinsi: l.province,
        paket: l.package.name,
        minggu: `M${p.weekNumber}/${p.totalWeeks}`,
        planPct: p.planPct,
        realizedPct: p.realizedPct,
        deviationPct: p.deviationPct,
        terpasang: Number(p.realizedValue),
        terakhirLapor: lapor ? formatTanggal(lapor) : null,
        // Keduanya tanggal kerja (@db.Date = tengah malam UTC), jadi selisihnya
        // bulat hari — tanpa jam yang bisa menggeser hasilnya.
        terakhirLaporHari: lapor
          ? Math.max(0, Math.round((hariIni.getTime() - lapor.getTime()) / SEHARI_MS))
          : null,
      };
    })
    // Deviasi terburuk dulu: itu urutan yang dicari orang saat membuka papan
    // ini, dan grid tetap bisa diurut ulang sesuka pemakainya.
    .sort((a, b) => a.deviationPct - b.deviationPct);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Progress Portfolio"
        description="Rencana vs realisasi berbasis volume – angka dihitung dari RAB aktif, baseline aktif, dan laporan harian terkirim."
        actions={
          can(user.role, "ai.view") ? (
            <Link
              href="/ai"
              className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-muted"
            >
              Buka di AI Intelligence
            </Link>
          ) : null
        }
      />
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label="Nilai RAB aktif" value={formatRupiahShort(totalRab)} sub="pra-PPN" />
        <KpiCard label="Nilai terpasang" value={formatRupiahShort(totalRealized)} />
        <KpiCard label="Rencana (tertimbang)" value={formatPct(avgPlan)} />
        <KpiCard
          label="Realisasi (tertimbang)"
          value={formatPct(avgActual)}
          tone={avgActual - avgPlan < -10 ? "danger" : avgActual - avgPlan < -1 ? "warning" : "success"}
          sub={`deviasi ${formatPct(avgActual - avgPlan)}`}
        />
      </section>
      <Card>
        <CardHeader
          title="Per lokasi"
          subtitle="Diurutkan dari deviasi terburuk · kolom terakhir lapor memisahkan yang tertinggal dari yang bahkan tidak melapor"
        />
        <CardBody>
          <ProgressGrid rows={rows} />
        </CardBody>
      </Card>
    </div>
  );
}
