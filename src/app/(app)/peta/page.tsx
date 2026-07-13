import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";
import { getPetaMarkers } from "@/lib/peta";
import { PageHeader } from "@/components/knmp/page-header";
import { PetaClient } from "./peta-client";

export default async function PetaPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;

  const locSelect = {
    id: true,
    slug: true,
    name: true,
    province: true,
    regency: true,
    status: true,
    gpsLat: true,
    gpsLng: true,
  };

  const locations = isCrossLocation(role)
    ? await db.location.findMany({ orderBy: { name: "asc" }, select: locSelect })
    : (
        await db.userLocationAssignment.findMany({
          where: { userId, unassignedAt: null },
          include: { location: { select: locSelect } },
          orderBy: { assignedAt: "asc" },
        })
      ).map((a) => a.location);

  const markers = await getPetaMarkers(locations);

  return (
    <>
      <PageHeader
        eyebrow="Peta"
        title="Peta Lokasi"
        subtitle={`${markers.length} lokasi berkoordinat. Klik titik untuk lihat progress, fase minggu ini, dan foto terbaru.`}
      />
      {markers.length === 0 ? (
        <p className="text-sm text-slate-400">Belum ada lokasi dengan koordinat GPS.</p>
      ) : (
        <PetaClient markers={markers} />
      )}
    </>
  );
}
