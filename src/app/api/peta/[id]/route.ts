import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { getLocationSnapshot, type KawalPanelPeta } from "@/lib/peta";
import { kawalUntukLokasi } from "@/lib/kawal/queries";

/** Snapshot lokasi untuk panel detail peta: auth → scope lokasi → JSON (BigInt aman). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID lokasi tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (user?.mustChangePassword) {
    return NextResponse.json({ error: "Ganti password terlebih dahulu." }, { status: 403 });
  }
  if (!user) {
    return NextResponse.json({ error: "Anda belum masuk. Silakan masuk dulu." }, { status: 401 });
  }
  if (!(await hasLocationAccess(user, id))) {
    return NextResponse.json({ error: "Tidak punya akses ke lokasi ini" }, { status: 403 });
  }

  const snap = await getLocationSnapshot(id);
  if (!snap) {
    return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
  }
  // Angka Kawal hanya untuk peran yang boleh melihat Kawal (DECISIONS 800).
  let kawal: KawalPanelPeta | null = null;
  if (can(user.role, "kawal.view")) {
    const k = (await kawalUntukLokasi([id])).get(id);
    if (k) {
      kawal = {
        realisasiPct: k.actualPct,
        rencanaPct: k.targetPct,
        deviasiPct: k.deviasiPct,
        mingguKe: k.weekNo,
        totalMinggu: k.maxWeeks,
        diambil: k.snapshotAt.toISOString(),
      };
    }
  }
  // Pelaksana tidak menerima rupiah, juga lewat API (DECISIONS 735).
  return NextResponse.json({ ...snap, ...(can(user.role, "money.view") ? {} : { contractValue: null }), kawal });
}
