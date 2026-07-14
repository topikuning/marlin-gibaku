import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewDocument } from "@/lib/documents";
import { isR2Configured, r2PresignGet } from "@/lib/r2";

/**
 * Unduh dokumen: auth → scope → redirect ke presigned URL R2 (120 detik).
 * Dokumen ber-lokasi mengikuti scope penugasan; dokumen paket/organisasi
 * cukup capability document.view.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID dokumen tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Belum masuk — silakan login" }, { status: 401 });
  }

  const doc = await db.document.findUnique({
    where: { id },
    select: { id: true, orgId: true, locationId: true, r2Key: true, title: true },
  });
  if (!doc || doc.orgId !== user.orgId) {
    return NextResponse.json({ error: "Dokumen tidak ditemukan" }, { status: 404 });
  }
  if (!(await canViewDocument(user, doc))) {
    return NextResponse.json({ error: "Tidak punya akses ke dokumen ini" }, { status: 403 });
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      { error: "Penyimpanan file (R2) belum dikonfigurasi — unduhan tidak tersedia. Hubungi admin." },
      { status: 503 },
    );
  }

  const url = await r2PresignGet(doc.r2Key, 120);
  return NextResponse.redirect(url, 302);
}
