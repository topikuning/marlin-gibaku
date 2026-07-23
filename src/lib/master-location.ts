import "server-only";
import { db } from "@/lib/db";

/**
 * Mitigasi lokasi ganda untuk jalur cepat (bypass): katalog `MasterLocation`
 * bisa memuat lokasi yang SUDAH ada sebagai Location riil (mis. dibuat lewat
 * alur normal di production). Instansiasi master → Location harus mengecualikan
 * yang sudah ada agar tidak dobel.
 *
 * Kunci alami lokasi = provinsi|kabupaten|kecamatan|desa (dinormalisasi).
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function locationKey(p: {
  province: string;
  regency: string;
  district: string | null;
  village: string;
}): string {
  return [norm(p.province), norm(p.regency), norm(p.district ?? ""), norm(p.village)].join("|");
}

/** Set kunci alami dari SELURUH Location riil milik org (lintas paket). */
export async function existingLocationKeys(orgId: string): Promise<Set<string>> {
  const locs = await db.location.findMany({
    where: { package: { orgId } },
    select: { province: true, regency: true, district: true, village: true },
  });
  return new Set(locs.map(locationKey));
}

export type CatalogItem = {
  id: string;
  province: string;
  regency: string;
  district: string | null;
  village: string;
  candidateVendor: string | null;
};

/**
 * Katalog master yang BENAR-BENAR tersedia untuk bypass: belum terpakai
 * (assignedLocationId null) DAN belum ada Location riil dgn kunci alami sama.
 * `hiddenExistingCount` = jumlah katalog yang disembunyikan karena sudah ada.
 */
export async function getAvailableCatalog(
  orgId: string,
): Promise<{ available: CatalogItem[]; hiddenExistingCount: number }> {
  const [masters, existing] = await Promise.all([
    db.masterLocation.findMany({
      where: { orgId, assignedLocationId: null },
      orderBy: [{ province: "asc" }, { regency: "asc" }, { village: "asc" }],
      select: {
        id: true,
        province: true,
        regency: true,
        district: true,
        village: true,
        candidateVendor: true,
      },
    }),
    existingLocationKeys(orgId),
  ]);
  const available = masters.filter((m) => !existing.has(locationKey(m)));
  return { available, hiddenExistingCount: masters.length - available.length };
}
