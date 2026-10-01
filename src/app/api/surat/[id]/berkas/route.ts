import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { accessibleLocationIds, getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { isR2Configured } from "@/lib/r2";
import { alamatBerkas } from "@/lib/penyimpanan/berkas";

/**
 * Unduh berkas surat (DECISIONS 436): auth → capability → scope → redirect ke
 * presigned URL R2 (120 detik).
 *
 * Sebelum ini berkas surat memang tersimpan tapi tidak punya pintu — arsip
 * yang tidak bisa dibuka sama saja dengan tidak diarsipkan.
 *
 * Scope-nya mengikuti aturan register: surat berpaket dibatasi lokasi
 * penugasan; surat yang belum menempel ke paket mana pun tetap terbuka bagi
 * yang boleh melihat register, karena itu memang belum menunjuk lokasi.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID surat tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (user?.mustChangePassword) {
    return NextResponse.json({ error: "Ganti password terlebih dahulu." }, { status: 403 });
  }
  if (!user) return NextResponse.json({ error: "Anda belum masuk. Silakan masuk dulu." }, { status: 401 });
  if (!can(user.role, "letter.view")) {
    return NextResponse.json({ error: "Tidak punya akses ke register surat" }, { status: 403 });
  }

  const surat = await db.letter.findUnique({
    where: { id },
    select: {
      orgId: true,
      fileR2Key: true,
      fileName: true,
      locationId: true,
      package: { select: { locations: { select: { id: true } } } },
    },
  });
  if (!surat || surat.orgId !== user.orgId) {
    return NextResponse.json({ error: "Surat tidak ditemukan" }, { status: 404 });
  }
  if (!surat.fileR2Key) {
    return NextResponse.json({ error: "Surat ini tidak punya berkas terarsip" }, { status: 404 });
  }

  const izin = await accessibleLocationIds(user);
  if (izin) {
    const terkait = [
      ...(surat.locationId ? [surat.locationId] : []),
      ...(surat.package?.locations ?? []).map((l) => l.id),
    ];
    // Hanya surat yang MEMANG menunjuk lokasi yang dibatasi; yang belum
    // menunjuk apa pun tidak bisa dinilai lewat lokasi.
    if (terkait.length > 0 && !terkait.some((lid) => izin.includes(lid))) {
      return NextResponse.json({ error: "Tidak punya akses ke surat ini" }, { status: 403 });
    }
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      { error: "Penyimpanan berkas (R2) belum diatur, jadi berkas belum bisa diunduh. Hubungi admin." },
      { status: 503 },
    );
  }

  const url = await alamatBerkas(surat.fileR2Key, 120);
  // Berkas yang sudah dipindah ke Lenovo beralamat relatif (/api/berkas/…) – DECISIONS 645.
  return NextResponse.redirect(new URL(url, req.url), 302);
}
