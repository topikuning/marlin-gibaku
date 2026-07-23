import type { Metadata } from "next";
import { Card, CardBody, CardHeader, KpiCard, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { duplicateGroups, listVendorsWithUsage } from "@/lib/vendor/queries";
import { VendorManager } from "./vendor-client";

export const metadata: Metadata = { title: "Master Perusahaan" };
export const dynamic = "force-dynamic";

export default async function VendorPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "contract.manage");

  const vendors = await listVendorsWithUsage(user.orgId);
  const groups = duplicateGroups(vendors);
  const dupCount = groups.reduce((s, g) => s + g.length, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Paket", href: "/paket" }, { label: "Master Perusahaan" }]}
        title="Master Perusahaan (Vendor)"
        description="Kelola daftar penyedia. Gabungkan entri duplikat (kontrak & komitmen dialihkan ke satu vendor), hapus yang belum terpakai."
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Total vendor" value={vendors.length} />
        <KpiCard label="Kemungkinan duplikat" value={dupCount} />
        <KpiCard label="Grup duplikat" value={groups.length} />
      </section>

      <Card>
        <CardHeader
          title="Daftar perusahaan"
          subtitle="“Gabung ke” mengalihkan semua kontrak/komitmen ke vendor tujuan lalu menghapus entri ini. Hapus hanya untuk vendor tanpa pemakaian."
        />
        <CardBody>
          <VendorManager
            vendors={vendors.map((v) => ({
              id: v.id,
              name: v.name,
              npwp: v.npwp,
              contractCount: v.contractCount,
              commitmentCount: v.commitmentCount,
              normKey: v.normKey,
            }))}
            duplicateKeys={groups.map((g) => g[0].normKey)}
          />
        </CardBody>
      </Card>
    </div>
  );
}
