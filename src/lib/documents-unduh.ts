import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { canViewDocument } from "@/lib/documents";
import { isR2Configured } from "@/lib/r2";
import { namaUnduhan, ruasNama } from "@/lib/penyimpanan/nama-unduhan";

/**
 * Pemeriksaan bersama dua alamat unduh dokumen (DECISIONS 676):
 * `/api/documents/<id>` (link lama di semua halaman) dan
 * `/api/documents/<id>/<nama>` (yang benar-benar menyerahkan isinya).
 *
 * Dokumen ber-lokasi mengikuti scope penugasan; dokumen paket/organisasi
 * cukup capability document.view. Dokumen DIBATALKAN hanya bisa diunduh oleh
 * yang berwenang membatalkan/memulihkan (audit & peninjauan) — bukan hilang,
 * tetapi juga tidak lagi beredar sebagai berkas resmi.
 */
export type DokumenUnduh = { id: string; r2Key: string; mimeType: string; nama: string };

export async function periksaUnduhDokumen(id: string): Promise<{ doc: DokumenUnduh } | { tolak: Response }> {
  const tolak = (error: string, status: number) => ({ tolak: NextResponse.json({ error }, { status }) });
  if (!z.uuid().safeParse(id).success) return tolak("ID dokumen tidak valid", 404);

  const user = await getCurrentUser();
  if (user?.mustChangePassword) return tolak("Ganti password terlebih dahulu.", 403);
  if (!user) return tolak("Anda belum masuk. Silakan masuk dulu.", 401);

  const doc = await db.document.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      packageId: true,
      locationId: true,
      r2Key: true,
      title: true,
      status: true,
      fileName: true,
      mimeType: true,
    },
  });
  if (!doc || doc.orgId !== user.orgId) return tolak("Dokumen tidak ditemukan", 404);
  if (!(await canViewDocument(user, doc))) return tolak("Tidak punya akses ke dokumen ini", 403);

  if (!isR2Configured()) {
    return tolak("Penyimpanan berkas (R2) belum diatur, jadi berkas belum bisa diunduh. Hubungi admin.", 503);
  }
  return {
    doc: {
      id: doc.id,
      r2Key: doc.r2Key,
      mimeType: doc.mimeType,
      // Nama saat diunggah; judul dokumen hanya cadangan bila namanya kosong.
      nama: namaUnduhan(doc.fileName || doc.title, doc.mimeType, namaUnduhan(doc.title, null)),
    },
  };
}

/** Alamat unduh yang membawa nama berkas di ruas terakhirnya (RELATIF). */
export function alamatUnduhDokumen(doc: Pick<DokumenUnduh, "id" | "nama">): string {
  return `/api/documents/${doc.id}/${ruasNama(doc.nama)}`;
}
