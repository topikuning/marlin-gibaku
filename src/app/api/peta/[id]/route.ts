import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasLocationAccess } from "@/lib/access";
import { getLocationSnapshot } from "@/lib/peta";

export const dynamic = "force-dynamic";

/** Snapshot lokasi untuk panel peta (progress + fase + foto), authz per lokasi. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  if (!(await hasLocationAccess(session.user.id, session.user.role, id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const snap = await getLocationSnapshot(id);
  if (!snap) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(snap);
}
