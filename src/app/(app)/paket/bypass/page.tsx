import type { Metadata } from "next";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getAvailableCatalog } from "@/lib/master-location";
import { BypassForm, type MasterLocationOption, type VendorOption } from "./bypass-form";

export const metadata: Metadata = { title: "Buat Proyek Cepat (Bypass)" };
export const dynamic = "force-dynamic";

export default async function BypassPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.bypass");

  const [{ available, hiddenExistingCount }, vendors] = await Promise.all([
    getAvailableCatalog(user.orgId),
    db.vendor.findMany({
      where: { orgId: user.orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const masterOptions: MasterLocationOption[] = available.map((m) => ({
    id: m.id,
    province: m.province,
    regency: m.regency,
    district: m.district,
    village: m.village,
    candidateVendor: m.candidateVendor,
  }));
  const vendorOptions: VendorOption[] = vendors.map((v) => ({ id: v.id, name: v.name }));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Paket", href: "/paket" }, { label: "Buat Cepat (Bypass)" }]}
        title="Buat Proyek Cepat (Bypass)"
        description="Jalur khusus admin: buat proyek langsung di tahap Kontrak tanpa proses pra-kontrak (prospek → tender → penetapan). Dokumen pengadaan bisa dilengkapi sambil berjalan. Mulai pekerjaan tetap lewat SPMK."
      />
      <Card>
        <CardHeader
          title="Data proyek & kontrak"
          subtitle="Pilih lokasi dari katalog master, tentukan vendor & data kontrak. Paket ditandai “bypass”."
        />
        <CardBody>
          <BypassForm
            masters={masterOptions}
            vendors={vendorOptions}
            hiddenExistingCount={hiddenExistingCount}
          />
        </CardBody>
      </Card>
    </div>
  );
}
