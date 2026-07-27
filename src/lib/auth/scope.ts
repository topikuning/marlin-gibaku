import type { SessionUser } from "@/lib/auth/session";

/**
 * Filter Prisma untuk `Location` sesuai scope user (audit 2026-07-27, B11).
 *
 * `accessibleLocationIds` mengembalikan `null` untuk role lintas lokasi
 * (super_admin / program_director / exec_viewer) — dan sebelum ini, `null`
 * diterjemahkan tiap halaman sebagai `{}` = TANPA filter apa pun, termasuk
 * tanpa filter organisasi. Single-org hari ini membuatnya dorman, tetapi
 * DECISIONS 150 baru saja menutup kebocoran kontak lintas-tenant yang persis
 * sekelas. Helper ini membuat "semua lokasi" selalu berarti "semua lokasi
 * ORGANISASI user", di SATU tempat.
 */
export function locationScopeWhere(user: SessionUser, locIds: string[] | null) {
  return locIds === null ? { package: { orgId: user.orgId } } : { id: { in: locIds } };
}

/** Varian untuk relasi `location` di model lain (mis. DailyReport.location). */
export function locationRelScopeWhere(user: SessionUser, locIds: string[] | null) {
  return locIds === null
    ? { location: { package: { orgId: user.orgId } } }
    : { locationId: { in: locIds } };
}
