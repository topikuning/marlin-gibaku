import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getLocationsProgress } from "@/lib/progress";
import { LokasiGrid, type LokasiRow } from "./lokasi-grid";

export const metadata: Metadata = { title: "Lokasi" };
export const dynamic = "force-dynamic";

/** Daftar lokasi (scoped by penugasan) — progress dihitung BATCH, bukan N+1. */
export default async function LokasiListPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "location.view");
  const locIds = await accessibleLocationIds(user);

  const locations = await db.location.findMany({
    where: locationScopeWhere(user, locIds),
    select: {
      id: true,
      name: true,
      slug: true,
      village: true,
      regency: true,
      province: true,
      status: true,
      package: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  const progress = await getLocationsProgress(locations.map((l) => l.id));

  const rows: LokasiRow[] = locations.map((l) => {
    const p = progress.get(l.id)!;
    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      wilayah: `${l.regency}, ${l.province}`,
      paket: l.package.name,
      status: l.status,
      planPct: p.planPct,
      realizedPct: p.realizedPct,
      deviationPct: p.deviationPct,
      rabValue: Number(p.grandTotal),
    };
  });
  const activeCount = locations.filter((location) => location.status === "berjalan").length;
  const criticalCount = rows.filter((row) => row.deviationPct < -10).length;
  const attentionCount = rows.filter((row) => row.deviationPct < 0 && row.deviationPct >= -10).length;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Pelaksanaan · scope sesuai akses"
        title="Monitor lokasi"
        description={`${rows.length} lokasi dalam lingkup akses Anda. Progress menggunakan level Dilaporkan sesuai calculation layer produksi.`}
      />
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        <LocationMetric label="Total lokasi" value={rows.length} />
        <LocationMetric label="Sedang berjalan" value={activeCount} tone="success" />
        <LocationMetric label="Perlu perhatian" value={attentionCount} tone="warning" />
        <LocationMetric label="Deviasi kritis" value={criticalCount} tone="danger" />
      </dl>
      <LokasiGrid rows={rows} />
    </div>
  );
}

function LocationMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className={`tabular mt-1 text-2xl font-semibold ${color}`}>{value}</dd>
    </div>
  );
}
