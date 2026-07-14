import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { getLocationSnapshot } from "@/lib/peta";

/** Snapshot lokasi untuk panel detail peta: auth → scope lokasi → JSON (BigInt aman). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID lokasi tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Belum masuk — silakan login" }, { status: 401 });
  }
  if (!(await hasLocationAccess(user, id))) {
    return NextResponse.json({ error: "Tidak punya akses ke lokasi ini" }, { status: 403 });
  }

  const snap = await getLocationSnapshot(id);
  if (!snap) {
    return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  }
  return NextResponse.json(snap);
}
