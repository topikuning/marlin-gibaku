import type { Metadata } from "next";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { jakartaDateKey } from "@/lib/format";
import { FormTemuanBaru } from "./form-baru";

export const metadata: Metadata = { title: "Catat Temuan" };
export const dynamic = "force-dynamic";

export default async function TemuanBaruPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "finding.create");
  const locIds = await accessibleLocationIds(user);

  const locations = await db.location.findMany({
    where: locationScopeWhere(user, locIds),
    orderBy: { name: "asc" },
    select: { id: true, name: true, regency: true },
  });

  // Kandidat PIC per lokasi = pemegang penugasan aktif lokasi itu.
  const assignments = locations.length
    ? await db.locationAssignment.findMany({
        where: { locationId: { in: locations.map((l) => l.id) }, unassignedAt: null, user: { isActive: true } },
        select: { locationId: true, user: { select: { id: true, fullName: true } } },
      })
    : [];
  const picByLocation: Record<string, { id: string; fullName: string }[]> = {};
  for (const a of assignments) {
    (picByLocation[a.locationId] ??= []).push(a.user);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Temuan", href: "/temuan" }, { label: "Catat temuan" }]}
        title="Catat Temuan"
        description="Temuan hanya dianggap selesai setelah verifikator menutupnya."
      />
      <Card>
        <CardHeader title="Temuan baru" />
        <CardBody>
          <FormTemuanBaru
            lokasi={locations.map((l) => ({ value: l.id, label: `${l.name} – ${l.regency}` }))}
            picByLocation={picByLocation}
            todayKey={jakartaDateKey(new Date())}
          />
        </CardBody>
      </Card>
    </div>
  );
}
