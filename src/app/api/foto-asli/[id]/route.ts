import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { isR2Configured, r2PresignGet } from "@/lib/r2";

/**
 * Unduh BERKAS ASLI sebuah foto — byte apa adanya dari perangkat, sebelum
 * kompresi & cap MARLIN. Ini arsip bukti mentah: EXIF utuh, resolusi penuh,
 * dipakai bila keaslian foto dipersoalkan (DECISIONS 197).
 *
 * SENGAJA di luar `/api/foto` — path itu PUBLIK (link token HMAC untuk PDF yang
 * dikirim ke WA, lihat middleware). Berkas asli tidak boleh ikut publik: wajib
 * sesi + akses lokasi pemilik fotonya.
 *
 * Foto lama (sebelum arsip ini ada) tidak punya berkas asli — dijawab 404 dgn
 * pesan yang menjelaskan, bukan pesan "tidak ditemukan" yang menyesatkan.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID foto tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Belum masuk – silakan login" }, { status: 401 });

  const photo = await db.photo.findUnique({
    where: { id },
    select: {
      originalKey: true,
      locationId: true,
      report: { select: { locationId: true } },
      activity: { select: { locationId: true } },
    },
  });
  if (!photo) return NextResponse.json({ error: "Foto tidak ditemukan" }, { status: 404 });

  const locationId = photo.locationId ?? photo.report?.locationId ?? photo.activity?.locationId ?? null;
  if (!locationId || !(await hasLocationAccess(user, locationId))) {
    return NextResponse.json({ error: "Tidak punya akses ke foto ini" }, { status: 403 });
  }

  if (!photo.originalKey) {
    return NextResponse.json(
      { error: "Foto ini diunggah sebelum arsip berkas asli aktif – hanya versi ber-cap yang tersimpan." },
      { status: 404 },
    );
  }
  if (!isR2Configured()) {
    return NextResponse.json({ error: "Penyimpanan file belum dikonfigurasi." }, { status: 503 });
  }

  const url = await r2PresignGet(photo.originalKey, 120);
  return NextResponse.redirect(url, 302);
}
