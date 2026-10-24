import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasLocationAccess } from "@/lib/auth/session";
import { isR2Configured } from "@/lib/r2";
import { alamatBerkas } from "@/lib/penyimpanan/berkas";
import { alihkanKeBerkas } from "@/lib/penyimpanan/alihkan";
import { kepalaDisposisi } from "@/lib/penyimpanan/nama-unduhan";
import { bacaBerkasAsli } from "@/lib/arsip-asli/antrean";

/** Ekstensi kunci arsip asli (`originalExt`) → jenis isi. Selain ini diunduh sebagai biner. */
const JENIS_ASLI: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

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
 *
 * Berkas asli dipindah ke arsip Lenovo oleh `arsip-asli/` dengan kolomnya
 * sendiri, BUKAN lewat `berkas_pindah` – jadi `alamatBerkas` tidak mengenalnya.
 * Sesudah salinan R2-nya dibuang (`originalR2PurgedAt`), isinya dibaca dari
 * arsip dan dikirim langsung; sebelum itu tetap dialihkan ke R2 (DECISIONS 702).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "ID foto tidak valid" }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (user?.mustChangePassword) {
    return NextResponse.json({ error: "Ganti password terlebih dahulu." }, { status: 403 });
  }
  if (!user) return NextResponse.json({ error: "Anda belum masuk. Silakan masuk dulu." }, { status: 401 });

  const photo = await db.photo.findUnique({
    where: { id },
    select: {
      originalKey: true,
      originalR2PurgedAt: true,
      originalPurgedAt: true,
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

  if (photo.originalPurgedAt) {
    return NextResponse.json(
      { error: "Berkas asli foto ini sudah dihapus permanen. Yang tersisa hanya versi ber-cap." },
      { status: 410 },
    );
  }
  if (!photo.originalKey) {
    return NextResponse.json(
      { error: "Foto ini diunggah sebelum arsip berkas asli dinyalakan, jadi yang tersimpan hanya versi ber-cap." },
      { status: 404 },
    );
  }

  if (photo.originalR2PurgedAt) {
    let isi: Buffer;
    try {
      isi = await bacaBerkasAsli({ originalKey: photo.originalKey, originalR2PurgedAt: photo.originalR2PurgedAt });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Arsip berkas asli sedang tidak bisa dihubungi." },
        { status: 503 },
      );
    }
    const nama = photo.originalKey.split("/").pop() ?? "foto-asli";
    const eks = /\.([a-z0-9]+)$/i.exec(nama)?.[1]?.toLowerCase() ?? "";
    const jenis = JENIS_ASLI[eks] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(isi), {
      headers: {
        "Content-Type": jenis,
        "Content-Disposition": kepalaDisposisi(nama, jenis),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (!isR2Configured()) {
    return NextResponse.json({ error: "Penyimpanan berkas belum diatur. Hubungi admin." }, { status: 503 });
  }
  const url = await alamatBerkas(photo.originalKey, 120);
  // Berkas yang sudah dipindah ke Lenovo beralamat relatif (/api/berkas/…) – DECISIONS 645.
  // Dikirim apa adanya; jangan disusun terhadap req.url (alamat dalam server).
  return alihkanKeBerkas(url);
}
