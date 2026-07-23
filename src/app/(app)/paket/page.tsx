import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, KpiCard, Banner } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { PACKAGE_STAGE_LABEL } from "@/lib/lifecycle";
import { formatRupiahShort } from "@/lib/format";
import { bigintToString } from "@/lib/money";
import {
  getPackageStats,
  listPackages,
  type PackageListFilter,
} from "@/lib/package/queries";
import type { PackageStage } from "@/generated/prisma/enums";
import { PaketGrid, type PaketRow } from "./paket-grid";

export const metadata: Metadata = { title: "Paket" };
export const dynamic = "force-dynamic";

function parseFilter(raw: string | undefined): PackageListFilter | undefined {
  if (!raw) return undefined;
  if (raw === "berkontrak") return "berkontrak";
  return raw in PACKAGE_STAGE_LABEL ? (raw as PackageStage) : undefined;
}

function filterLabel(filter: PackageListFilter): string {
  return filter === "berkontrak" ? "Berkontrak" : PACKAGE_STAGE_LABEL[filter];
}

export default async function PaketPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { stage } = await searchParams;
  const filter = parseFilter(stage);

  const [stats, packages] = await Promise.all([getPackageStats(), listPackages(filter)]);

  // BigInt → string di boundary server→client (JSON tidak dukung BigInt).
  const rows = bigintToString(
    packages.map((p) => ({
      id: p.id,
      packageNumber: p.packageNumber ?? "—",
      name: p.name,
      stage: p.stage,
      province: p.province ?? "—",
      hpsValue: p.hpsValue,
      vendorName: p.contract?.vendor.name ?? p.candidateVendorName ?? "—",
      locationCount: p._count.locations,
      updatedAt: p.updatedAt.toISOString(),
    })),
  ) as unknown as PaketRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paket"
        description="Funnel paket pekerjaan: prospek → tender → penetapan → kontrak → pelaksanaan."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(user.role, "contract.manage") ? (
              <Link
                href="/paket/vendor"
                className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-muted"
              >
                Master Perusahaan
              </Link>
            ) : null}
            {can(user.role, "package.bypass") ? (
              <>
                <Link
                  href="/paket/katalog"
                  className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-muted"
                >
                  Katalog Lokasi
                </Link>
                <Link
                  href="/paket/bypass"
                  className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-muted"
                >
                  Buat Cepat (Bypass)
                </Link>
              </>
            ) : null}
            {can(user.role, "package.create") ? (
              <Link
                href="/paket/baru"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-800"
              >
                Paket Baru
              </Link>
            ) : null}
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total paket" value={stats.total} href="/paket" />
        <KpiCard label="Dalam tender" value={stats.tender} href="/paket?stage=tender" />
        <KpiCard label="Berkontrak" value={stats.berkontrak} href="/paket?stage=berkontrak" />
        <KpiCard
          label="Nilai HPS total"
          value={formatRupiahShort(stats.totalHps)}
          sub="tanpa paket batal"
        />
      </section>

      {filter ? (
        <Banner
          tone="info"
          title={`Menampilkan ${rows.length} paket dengan filter "${filterLabel(filter)}".`}
          description={
            <Link href="/paket" className="font-medium text-primary hover:underline">
              Hapus filter
            </Link>
          }
        />
      ) : null}

      <PaketGrid rows={rows} />
    </div>
  );
}
