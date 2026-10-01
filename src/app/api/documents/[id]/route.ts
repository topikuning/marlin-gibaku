import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewDocument } from "@/lib/documents";
import { isR2Configured } from "@/lib/r2";
import { alamatBerkas } from "@/lib/penyimpanan/berkas";

/**
 * Unduh dokumen: auth → scope → redirect ke presigned URL R2 (120 detik).
 * Dokumen ber-lokasi mengikuti scope penugasan; dokumen paket/organisasi
 * cukup capability document.view. Dokumen DIBATALKAN hanya bisa diunduh oleh
 * yang berwenang membatalkan/memulihkan (audit & peninjauan) — bukan hilang,
 * tetapi juga tidak lagi beredar sebagai berkas resmi.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID dokumen tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (user?.mustChangePassword) {
    return NextResponse.json({ error: "Ganti password terlebih dahulu." }, { status: 403 });
  }
  if (!user) {
    return NextResponse.json({ error: "Belum masuk – silakan login" }, { status: 401 });
  }

  const doc = await db.document.findUnique({
    where: { id },
    select: { id: true, orgId: true, packageId: true, locationId: true, r2Key: true, title: true, status: true },
  });
  if (!doc || doc.orgId !== user.orgId) {
    return NextResponse.json({ error: "Dokumen tidak ditemukan" }, { status: 404 });
  }
  if (!(await canViewDocument(user, doc))) {
    return NextResponse.json({ error: "Tidak punya akses ke dokumen ini" }, { status: 403 });
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      { error: "Penyimpanan file (R2) belum dikonfigurasi – unduhan tidak tersedia. Hubungi admin." },
      { status: 503 },
    );
  }

  const url = await alamatBerkas(doc.r2Key, 120);
  // Berkas yang sudah dipindah ke Lenovo beralamat relatif (/api/berkas/…) – DECISIONS 645.
  return NextResponse.redirect(new URL(url, req.url), 302);
}
