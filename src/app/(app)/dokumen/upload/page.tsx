import type { Metadata } from "next";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Unggah Dokumen" };
export const dynamic = "force-dynamic";

export default async function UploadDokumenPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "document.upload");
  const scoped = await accessibleLocationIds(user);
  const [packages, locations] = await Promise.all([
    db.package.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.location.findMany({
      where: scoped === null ? {} : { id: { in: scoped } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Unggah Dokumen"
        breadcrumb={[{ label: "Dokumen", href: "/dokumen" }, { label: "Unggah" }]}
        description="Dokumen terhubung ke paket/lokasi dan bisa menjadi bukti milestone administrasi."
      />
      <Card>
        <CardHeader title="Formulir" />
        <CardBody>
          <UploadForm packages={packages} locations={locations} />
        </CardBody>
      </Card>
    </div>
  );
}
