import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { isR2Configured, r2PresignGet } from "@/lib/r2";

/**
 * Unduh lampiran kegiatan lapangan: auth → scope lokasi → redirect ke presigned
 * URL R2 (120 detik). Aksesnya mengikuti penugasan lokasi kegiatan tsb.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID lampiran tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Belum masuk — silakan login" }, { status: 401 });
  }

  const att = await db.fieldActivityAttachment.findUnique({
    where: { id },
    select: { r2Key: true, activity: { select: { locationId: true } } },
  });
  if (!att?.activity) {
    return NextResponse.json({ error: "Lampiran tidak ditemukan" }, { status: 404 });
  }
  if (!(await hasLocationAccess(user, att.activity.locationId))) {
    return NextResponse.json({ error: "Tidak punya akses ke lampiran ini" }, { status: 403 });
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      { error: "Penyimpanan file (R2) belum dikonfigurasi — unduhan tidak tersedia. Hubungi admin." },
      { status: 503 },
    );
  }

  const url = await r2PresignGet(att.r2Key, 120);
  return NextResponse.redirect(url, 302);
}
