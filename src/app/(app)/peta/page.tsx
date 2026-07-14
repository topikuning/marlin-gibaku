import type { Metadata } from "next";
import { MapPinOff } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getPetaMarkers } from "@/lib/peta";
import { PetaClient } from "./peta-client";

export const metadata: Metadata = { title: "Peta" };
export const dynamic = "force-dynamic";

/** Peta sebaran lokasi (scoped penugasan) — hanya lokasi ber-koordinat GPS. */
export default async function PetaPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "location.view");
  const markers = await getPetaMarkers(await accessibleLocationIds(user));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Peta Lokasi"
        description={`${markers.length} lokasi ber-koordinat GPS dalam lingkup akses Anda.`}
      />
      {markers.length === 0 ? (
        <EmptyState
          icon={MapPinOff}
          title="Belum ada lokasi dengan koordinat GPS"
          description="Lengkapi koordinat GPS lokasi agar tampil di peta."
        />
      ) : (
        <PetaClient markers={markers} />
      )}
    </div>
  );
}
