import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * PETA DASAR DISIMPAN DI VOLUME SENDIRI — bukan di R2.
 *
 * Teguran user 2026-09-06: *"R2 antara dev dan production berbeda, lalu apa
 * yang kamu harapkan. kenapa tidak kamu simpan langsung saja di lokal,
 * production punya volume dedicated."*
 *
 * Benar, dan rancangan pertama saya salah di dua hal sekaligus:
 *
 * 1. **Satu berkas di R2 hanya melayani satu lingkungan.** R2 dev dan produksi
 *    berbeda bucket, jadi mengunggah "ke R2" lewat satu workflow CI berarti
 *    salah satunya pasti tidak kebagian — dan yang tidak kebagian itu diam,
 *    cuma terlihat sebagai peta kosong.
 * 2. **Peta dasar bukan dokumen.** Ia bukan milik satu organisasi, tidak perlu
 *    dicadangkan, dan tidak pernah berubah antar-tenant: ia berkas statis yang
 *    sama untuk semua orang. Menaruhnya di penyimpanan objek berarti membayar
 *    tanda tangan URL, jalur unduh, dan kunci akses untuk sesuatu yang cukup
 *    diletakkan di disk yang sudah ada.
 *
 * Jadi ia hidup di VOLUME, mengikuti pola `LAMPIRAN_DIR` yang sudah terbukti:
 * direktorinya disiapkan `docker-entrypoint.sh` saat masih root (volume Railway
 * dipasang milik root — pelajaran 2026-09-03), lalu ditulis & dibaca aplikasi
 * sebagai `marlin`. Tiap lingkungan punya salinannya sendiri, dan tidak ada
 * satu pun kunci yang perlu disamakan antar-lingkungan.
 */

/** Direktori peta di volume. Sejajar dengan `LAMPIRAN_DIR`. */
export const DIR_PETA = env.PETA_DIR?.trim() || "/app/.data/peta";

/** Nama berkasnya tetap — satu peta dasar per lingkungan, tidak berversi. */
export const NAMA_BASEMAP = "basemap.pmtiles";

export const jalurBasemap = path.join(DIR_PETA, NAMA_BASEMAP);

export type BerkasPeta = { ada: boolean; ukuran: number; diperbarui: Date | null };

export async function periksaBasemap(): Promise<BerkasPeta> {
  try {
    const s = await stat(jalurBasemap);
    // Berkas kosong = unduhan yang mati di tengah jalan. Diperlakukan sebagai
    // TIDAK ADA supaya layar mengatakannya, bukan menyajikan peta rusak.
    if (s.size === 0) return { ada: false, ukuran: 0, diperbarui: null };
    return { ada: true, ukuran: s.size, diperbarui: s.mtime };
  } catch {
    return { ada: false, ukuran: 0, diperbarui: null };
  }
}

/** Satu unduhan pada satu waktu, per proses. */
let sedangUnduh: Promise<{ ukuran: number }> | null = null;

export function unduhanBerjalan(): boolean {
  return sedangUnduh !== null;
}

/**
 * Unduh peta dasar ke volume.
 *
 * Ditulis ke berkas SEMENTARA lalu diganti nama saat selesai: unduhan 300 MB
 * yang putus di tengah tidak boleh meninggalkan berkas separuh yang terlihat
 * seperti peta yang siap dipakai. Kalau prosesnya mati, yang tertinggal cuma
 * `.bagian` yang diabaikan pembaca dan ditimpa percobaan berikutnya.
 */
export async function unduhBasemap(sumber: string): Promise<{ ukuran: number }> {
  if (sedangUnduh) return sedangUnduh;
  sedangUnduh = (async () => {
    await mkdir(DIR_PETA, { recursive: true });
    const sementara = `${jalurBasemap}.bagian`;
    const res = await fetch(sumber, { redirect: "follow" });
    if (!res.ok || !res.body) {
      throw new Error(`Sumber peta menjawab ${res.status} ${res.statusText || ""}`.trim());
    }
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(sementara));
    const s = await stat(sementara);
    if (s.size === 0) {
      await unlink(sementara).catch(() => {});
      throw new Error("Berkas yang terunduh kosong.");
    }
    await rename(sementara, jalurBasemap);
    return { ukuran: s.size };
  })();
  try {
    return await sedangUnduh;
  } finally {
    sedangUnduh = null;
  }
}
