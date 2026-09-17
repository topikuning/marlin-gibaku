import "server-only";
import { db } from "@/lib/db";
import { accessibleLocationIds, ForbiddenError, hasLocationAccess, type SessionUser } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";

/** Sama dengan daftar dokumen: lokasi sendiri, paketnya, atau dokumen organisasi. */
export async function hasDocumentScope(user: SessionUser, doc: { locationId?: string | null; packageId?: string | null }): Promise<boolean> {
  if (doc.locationId) return hasLocationAccess(user, doc.locationId);
  if (!doc.packageId) return true;
  const scope = await accessibleLocationIds(user);
  return !!await db.package.findFirst({
    where: { id: doc.packageId, ...packageScopeWhere(user, scope) },
    select: { id: true },
  });
}

export async function requireDocumentScope(user: SessionUser, doc: { locationId?: string | null; packageId?: string | null }): Promise<void> {
  if (!await hasDocumentScope(user, doc)) throw new ForbiddenError("Tidak punya akses ke dokumen paket/lokasi ini");
}
