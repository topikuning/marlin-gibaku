import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { hasLocationAccess } from "@/lib/access";
import { r2PresignGet, isR2Configured } from "@/lib/r2";

export const dynamic = "force-dynamic";

/** Download dokumen via presigned GET (privat, authz per lokasi). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const doc = await db.document.findUnique({
    where: { id },
    select: { r2Key: true, locationId: true },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Dokumen ber-lokasi → butuh akses lokasi tsb.
  if (doc.locationId) {
    const ok = await hasLocationAccess(
      session.user.id,
      session.user.role,
      doc.locationId
    );
    if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!isR2Configured()) {
    return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  }

  const url = await r2PresignGet(doc.r2Key, 120);
  return NextResponse.redirect(url);
}
