import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";
import { getPetaMarkers } from "@/lib/peta";
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
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-slate-900">Peta Lokasi</h1>
        <span className="text-xs text-slate-400">{markers.length} lokasi · cari & filter di panel kiri</span>
      </div>
      {markers.length === 0 ? (
        <p className="text-sm text-slate-400">Belum ada lokasi dengan koordinat GPS.</p>
      ) : (
        <PetaClient markers={markers} />
      )}
    </>
  );
}
