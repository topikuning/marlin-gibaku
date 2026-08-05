import type { Metadata } from "next";
import Link from "next/link";
import { MapPinOff } from "lucide-react";
import { Banner, EmptyState, PageHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getLokasiTanpaKoordinat, getPetaMarkers } from "@/lib/peta";
import { PetaClient } from "./peta-client";

export const metadata: Metadata = { title: "Peta" };
export const dynamic = "force-dynamic";

/** Peta sebaran lokasi (scoped penugasan) — hanya lokasi ber-koordinat GPS. */
export default async function PetaPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "location.view");
  const scoped = await accessibleLocationIds(user);
  const [markers, tanpaKoordinat] = await Promise.all([
    getPetaMarkers(scoped, user.orgId),
    getLokasiTanpaKoordinat(scoped, user.orgId),
  ]);

  // Lokasi tanpa koordinat lenyap dari peta tanpa jejak — sebutkan, dan
  // tautkan langsung ke tempat koordinatnya diisi.
  const daftarBelum =
    tanpaKoordinat.length > 0 ? (
      <div className="space-y-2">
        <Banner
          tone="warning"
          title={`${tanpaKoordinat.length} lokasi tidak tampil di peta karena belum ada koordinat`}
          description="Buka lokasinya, lalu isi lewat kartu “Alamat & koordinat”."
        />
        <ul className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[13px]">
          {tanpaKoordinat.map((l) => (
            <li key={l.id}>
              <Link href={`/proyek/lokasi/${l.slug}`} className="text-primary hover:underline">
                {l.name}
              </Link>
              <span className="text-ink-muted"> · {l.regency}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Peta Lokasi"
        description={`${markers.length} lokasi ber-koordinat GPS dalam lingkup akses Anda.`}
      />
      {daftarBelum}
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
