import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { existingLocationIndex, statusKatalog } from "@/lib/master-location/queries";
import { KatalogLokasiManager, type BarisKatalog } from "./lokasi-client";

export const metadata: Metadata = { title: "Katalog Lokasi" };
export const dynamic = "force-dynamic";

/**
 * KATALOG LOKASI — pindah dari `/paket/katalog` ke Master Data (DECISIONS 368).
 *
 * Ia data induk, bukan bagian dari satu paket: paket MEMAKAI lokasi, dan lokasi
 * yang sama bisa dipakai paket mana pun. Selama ia bersarang di bawah `/paket`,
 * orang yang mencari "master lokasi" tidak menemukannya di tempat semua master
 * lain berada.
 */
export default async function MasterLokasiPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.bypass");

  const [masters, realIndex, vendors] = await Promise.all([
    db.masterLocation.findMany({
      where: { orgId: user.orgId },
      orderBy: [{ province: "asc" }, { regency: "asc" }, { village: "asc" }],
      select: {
        id: true,
        province: true,
        regency: true,
        district: true,
        village: true,
        latitude: true,
        longitude: true,
        candidateVendor: true,
        assignedLocationId: true,
      },
    }),
    existingLocationIndex(user.orgId),
    db.vendor.findMany({
      where: { orgId: user.orgId },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  ]);

  const rows: BarisKatalog[] = masters.map((m) => ({
    id: m.id,
    province: m.province,
    regency: m.regency,
    district: m.district,
    village: m.village,
    // Decimal → string di batas server→client; komponen hanya menampilkan.
    latitude: m.latitude?.toString() ?? null,
    longitude: m.longitude?.toString() ?? null,
    candidateVendor: m.candidateVendor,
    status: statusKatalog(m, realIndex.has(m)),
  }));

  return <KatalogLokasiManager rows={rows} vendors={vendors.map((v) => v.name)} />;
}
