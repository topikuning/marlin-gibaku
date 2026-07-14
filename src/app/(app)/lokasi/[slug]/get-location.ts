import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, hasLocationAccess, type SessionUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";

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
      regency: true,
      province: true,
      status: true,
      isActive: true,
      package: {
        select: {
          id: true,
          name: true,
          packageNumber: true,
          contract: {
            select: {
              contractNumber: true,
              contractValue: true,
              ppnPercent: true,
              startDate: true,
              endDate: true,
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
