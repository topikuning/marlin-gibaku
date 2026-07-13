import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";
import { PageHeader } from "@/components/knmp/page-header";
import { LokasiGrid } from "./lokasi-grid";

export default async function LokasiPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");

  const { id, role } = session.user;

  // Scoping: lintas-lokasi lihat semua; scoped hanya yang ditugaskan.
  const where: Prisma.LocationWhereInput = isCrossLocation(role)
    ? {}
    : { assignments: { some: { userId: id, unassignedAt: null } } };

  const locations = await db.location.findMany({
    where,
    include: { contract: { include: { contractor: true } } },
    orderBy: [{ province: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader
        eyebrow="Lokasi"
        title="Daftar Lokasi"
        subtitle={`${locations.length} lokasi ${isCrossLocation(role) ? "di sistem" : "ditugaskan ke Anda"}.`}
      />

      <LokasiGrid
        rows={locations.map((loc) => ({
          id: loc.id,
          slug: loc.slug,
          name: loc.name,
          regency: loc.regency,
          province: loc.province,
          contractor: loc.contract.contractor.name,
          valueNum: Number(loc.contract.contractValue),
          status: loc.status,
        }))}
      />
    </>
  );
}
