import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  requireUser,
  hasLocationAccess,
  accessibleLocationIds,
  type SessionUser,
} from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getLocationsProgress } from "@/lib/progress";
import type { SiblingLocation } from "./location-switcher";

export type LocationCtx = {
  user: SessionUser;
  location: NonNullable<Awaited<ReturnType<typeof findLocation>>>;
};

function findLocation(slug: string) {
  return db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      village: true,
      district: true,
      regency: true,
      province: true,
      gpsLat: true,
      gpsLng: true,
      status: true,
      isActive: true,
      // Pelaksana Lapangan lokasi ini (penimpaan) + milik paket sebagai
      // cadangan — dibaca `pilihPelaksana` (DECISIONS 402).
      pelaksanaName: true,
      pelaksanaTitle: true,
      pelaksanaTtdKey: true,
      // Konsultan Pengawas lokasi ini (penimpaan) + milik kontrak sebagai
      // cadangan — dibaca `pilihPengawas` (DECISIONS 409).
      supervisorName: true,
      supervisorFirm: true,
      supervisorTtdKey: true,
      package: {
        select: {
          id: true,
          name: true,
          packageNumber: true,
          pelaksanaName: true,
          pelaksanaTitle: true,
          contract: {
            select: {
              id: true,
              contractNumber: true,
              contractValue: true,
              ppnPercent: true,
              durationDays: true,
              startDate: true,
              endDate: true,
              supervisorName: true,
              supervisorFirm: true,
              vendor: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Guard semua halaman /lokasi/[slug]/**: login + location.view + scope.
 * Slug salah ATAU tanpa akses → 404 (tidak membocorkan keberadaan lokasi,
 * konvensi sama dgn page-guard). Di-cache per request (layout + page share).
 */
export const requireLocationPage = cache(async (slug: string): Promise<LocationCtx> => {
  const user = await requireUser();
  requireCapabilityPage(user.role, "location.view");
  const location = await findLocation(slug);
  if (!location) notFound();
  if (!(await hasLocationAccess(user, location.id))) notFound();
  return { user, location };
});

/**
 * Lokasi lain di paket yang sama untuk pemilih lokasi di header (DECISIONS 204).
 *
 * Hanya yang BOLEH diakses user yang dikembalikan; sisanya dihitung supaya
 * bisa disebut jumlahnya di UI — daftar bersumber data tidak boleh membuat
 * "tidak muncul" terbaca "tidak ada" (CLAUDE.md).
 *
 * Urutan ABJAD, bukan deviasi terburuk: posisi yang berpindah tiap hari
 * membuat otot memori tak pernah terbentuk, dan "yang perlu perhatian" sudah
 * punya tempatnya sendiri di dashboard.
 */
export const getSiblingLocations = cache(
  async (
    user: SessionUser,
    packageId: string,
  ): Promise<{ siblings: SiblingLocation[]; hiddenCount: number }> => {
    const scoped = await accessibleLocationIds(user);
    const all = await db.location.findMany({
      where: { packageId },
      select: { id: true, slug: true, name: true, regency: true, status: true },
      orderBy: { name: "asc" },
    });
    const boleh = scoped === null ? all : all.filter((l) => scoped.includes(l.id));
    if (boleh.length === 0) return { siblings: [], hiddenCount: all.length };

    const progress = await getLocationsProgress(boleh.map((l) => l.id));
    return {
      siblings: boleh.map((l) => {
        const p = progress.get(l.id);
        return {
          slug: l.slug,
          name: l.name,
          regency: l.regency,
          status: l.status,
          // Tanpa baseline aktif, deviasi = realisasi − 0 = angka yang tidak
          // berarti apa-apa. Null di sini dibaca UI sebagai "belum ada rencana".
          deviationPct: p?.activeBaselineId ? p.deviationPct : null,
        };
      }),
      hiddenCount: all.length - boleh.length,
    };
  },
);
