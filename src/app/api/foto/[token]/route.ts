import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isR2Configured, r2PresignGet } from "@/lib/r2";
import { verifyPhotoToken } from "@/lib/pdf/photo-token";

/**
 * Foto publik lewat MARLIN — link permanen yang bisa dibuka SIAPA SAJA (tanpa
 * login) untuk melihat gambar PENUH (tak ter-crop) dari PDF yang dikirim ke WA.
 * Keamanan = token HMAC (bukan tebak id). Route ini PUBLIK (lihat middleware).
 * Setiap akses regen presigned R2 pendek. DECISIONS 125.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const photoId = verifyPhotoToken(token);
  if (!photoId) return NextResponse.json({ error: "Link tidak valid atau kedaluwarsa." }, { status: 404 });

  const photo = await db.photo.findUnique({ where: { id: photoId }, select: { r2Key: true } });
  if (!photo) return NextResponse.json({ error: "Foto tidak ditemukan." }, { status: 404 });

  if (!isR2Configured()) {
    return NextResponse.json({ error: "Penyimpanan file belum dikonfigurasi." }, { status: 503 });
  }
  const url = await r2PresignGet(photo.r2Key, 300);
  return NextResponse.redirect(url, 302);
}
