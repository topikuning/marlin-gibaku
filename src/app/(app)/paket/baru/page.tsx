import type { Metadata } from "next";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { PaketBaruForm } from "./paket-baru-form";

export const metadata: Metadata = { title: "Paket Baru" };
export const dynamic = "force-dynamic";

export default async function PaketBaruPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.create");
  requireCapabilityPage(user.role, "prospect.manage");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Paket", href: "/paket" }, { label: "Paket Baru" }]}
        title="Paket Baru"
        description="Paket dimulai sebagai prospek. Lokasi target dan konversi kontrak dilakukan dari workspace paket."
      />
      <Card>
        <CardHeader title="Data prospek" />
        <CardBody>
          <PaketBaruForm />
        </CardBody>
      </Card>
    </div>
  );
}
