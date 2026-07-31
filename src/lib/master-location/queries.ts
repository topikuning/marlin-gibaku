import "server-only";
import { db } from "@/lib/db";

/**
 * Mitigasi lokasi ganda untuk jalur cepat (bypass): katalog `MasterLocation`
 * bisa memuat lokasi yang SUDAH ada sebagai Location riil (mis. dibuat lewat
 * alur normal di production). Instansiasi master → Location harus mengecualikan
 * yang sudah ada agar tidak dobel.
 *
 * Ada DUA pembanding, sengaja berbeda — jangan ditukar:
 * - `locationKey` (ketat, termasuk kecamatan): katalog ↔ katalog, mis. dedup
 *   baris impor. Kedua sisi berasal dari file yang sama, kecamatan selalu ada.
 * - `existingLocationIndex` (longgar soal kecamatan): katalog ↔ Location RIIL.
 *   Lihat alasannya di atas fungsi itu.
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Kunci alami KETAT = provinsi|kabupaten|kecamatan|desa. Katalog ↔ katalog saja. */
export function locationKey(p: {
  province: string;
  regency: string;
  district: string | null;
  village: string;
}): string {
  return [norm(p.province), norm(p.regency), norm(p.district ?? ""), norm(p.village)].join("|");
}

export type LocationIdentity = {
  province: string;
  regency: string;
  district: string | null;
  village: string;
};

/**
 * Pencocokan katalog ↔ Location RIIL. Kunci alami penuh (dgn kecamatan) tidak
 * bisa dipakai di sini: Location riil sering dibuat tanpa kecamatan (kolomnya
 * opsional & baru ada belakangan), sementara baris katalog hampir selalu
 * mengisinya — akibatnya TIDAK ADA yang pernah cocok dan lokasi yang sudah
 * terpakai tetap muncul sebagai "tersedia" (dilaporkan user 2026-07-31: 73 dari
 * 73 baris lolos, 5 di antaranya jelas sudah dipakai).
 *
 * Aturan: provinsi+kabupaten+desa harus sama, DAN kecamatan dianggap cocok bila
 * sama ATAU salah satu sisi kosong. Desa senama di dua kecamatan berbeda (yang
 * dua-duanya terisi) tetap dibedakan — itu memang lokasi yang berbeda.
 *
 * Perbandingan juga ABAI SPASI: nama desa Indonesia ditulis tidak konsisten
 * antar sumber ("Kedungmutih" di katalog vs "Kedung Mutih" di Location riil —
 * kasus nyata di data ini), dan itu desa yang sama.
 */
export type ExistingLocationIndex = {
  has: (p: LocationIdentity) => boolean;
  size: number;
};

/** Normalisasi longgar: huruf kecil, tanpa spasi sama sekali. */
const normLoose = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

function baseKey(p: LocationIdentity): string {
  return [normLoose(p.province), normLoose(p.regency), normLoose(p.village)].join("|");
}

export function buildExistingLocationIndex(locs: LocationIdentity[]): ExistingLocationIndex {
  const byBase = new Map<string, Set<string>>();
  for (const l of locs) {
    const k = baseKey(l);
    const set = byBase.get(k) ?? new Set<string>();
    set.add(normLoose(l.district ?? ""));
    byBase.set(k, set);
  }
  return {
    size: locs.length,
    has(p) {
      const districts = byBase.get(baseKey(p));
      if (!districts) return false;
      const d = normLoose(p.district ?? "");
      return d === "" || districts.has("") || districts.has(d);
    },
  };
}

/** Index Location riil milik org (lintas paket) untuk dicocokkan dgn katalog. */
export async function existingLocationIndex(orgId: string): Promise<ExistingLocationIndex> {
  const locs = await db.location.findMany({
    where: { package: { orgId } },
    select: { province: true, regency: true, district: true, village: true },
  });
  return buildExistingLocationIndex(locs);
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
    existingLocationIndex(orgId),
  ]);
  const available = masters.filter((m) => !existing.has(m));
  return { available, hiddenExistingCount: masters.length - available.length };
}
