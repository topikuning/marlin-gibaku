import type { Metadata } from "next";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { jakartaDateKey } from "@/lib/format";
import { FormInspeksiBaru } from "./form-baru";

export const metadata: Metadata = { title: "Catat Inspeksi" };
export const dynamic = "force-dynamic";

export default async function InspeksiBaruPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "inspection.manage");
  const locIds = await accessibleLocationIds(user);
  const locations = await db.location.findMany({
    where: locationScopeWhere(user, locIds),
    orderBy: { name: "asc" },
    select: { id: true, name: true, regency: true },
  });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Verifikasi", href: "/verifikasi" }, { label: "Catat inspeksi" }]}
        title="Catat Inspeksi"
        description="Tersimpan sebagai draft dulu – finalkan setelah temuannya diangkat dan buktinya ditautkan."
      />
      <Card>
        <CardHeader title="Inspeksi baru" />
        <CardBody>
          <FormInspeksiBaru
            lokasi={locations.map((l) => ({ value: l.id, label: `${l.name} – ${l.regency}` }))}
            todayKey={jakartaDateKey(new Date())}
          />
        </CardBody>
      </Card>
    </div>
  );
}
