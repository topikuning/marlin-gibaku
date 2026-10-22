import "server-only";
import { db } from "@/lib/db";
import { buangPintasan } from "./client";

/**
 * Buang SATU foto laporan yang dihapus di MARLIN dari folder Drive paket
 * (DECISIONS 696) – foto susulan yang salah tempel tidak boleh tertinggal di
 * folder pemberi kerja.
 *
 * Berkasnya DIBUANG KE SAMPAH (masih bisa dipulihkan dari Drive), bukan dihapus
 * permanen – pola yang sama dengan shortcut dokumentasi.
 *
 * Nama berkas foto di Drive mengikuti URUTAN foto laporan, jadi berkas yang
 * sama bisa sudah ditimpa foto lain pada unggahan berikutnya. Yang dibuang
 * hanya berkas yang jejak unggahan TERAKHIR-nya memang foto ini.
 *
 * Best-effort: kegagalan dikembalikan sebagai kalimat untuk disebut di layar,
 * tidak menggagalkan penghapusan di MARLIN.
 */
export async function buangFotoDariDrive(photoId: string): Promise<{ dibuang: number; galat: string | null }> {
  try {
    const jejak = await db.gDriveUpload.findMany({
      where: { photoId, status: "sukses", fileId: { not: null } },
      select: { fileId: true },
    });
    let dibuang = 0;
    for (const fileId of new Set(jejak.map((j) => j.fileId!))) {
      const terakhir = await db.gDriveUpload.findFirst({
        where: { fileId, status: "sukses" },
        orderBy: { createdAt: "desc" },
        select: { photoId: true },
      });
      if (terakhir?.photoId !== photoId) continue;
      // `buangPintasan` memindah berkas APA PUN ke Sampah – namanya dari pemakai pertamanya.
      await buangPintasan(fileId);
      dibuang++;
    }
    const pintasan = await db.gDrivePintasanFoto.findUnique({
      where: { photoId },
      select: { shortcutId: true },
    });
    if (pintasan) {
      if (pintasan.shortcutId) await buangPintasan(pintasan.shortcutId);
      await db.gDrivePintasanFoto.delete({ where: { photoId } }).catch(() => undefined);
    }
    return { dibuang, galat: null };
  } catch (err) {
    console.error("[gdrive] buang foto dari Drive gagal:", err);
    return { dibuang: 0, galat: err instanceof Error ? err.message : String(err) };
  }
}
