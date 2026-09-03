/**
 * SIMPANAN LOKAL LAMPIRAN — di mana berkasnya ditulis, dan apakah ia bertahan.
 *
 * Dipisah dari `lampiran-tangkap.ts` supaya bisa dipanggil dari mana saja
 * (layar, route berkas, uji) tanpa menyeret Prisma dan seluruh env produksi
 * ikut termuat. Yang di sini murni urusan berkas.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Direktori simpanan lokal. Dibuat otomatis bila belum ada. */
export function direktoriLampiran(): string {
  return process.env.LAMPIRAN_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), ".data", "lampiran");
}

/**
 * Direktori yang BENAR-BENAR bisa ditulis, dengan cadangan.
 *
 * Kejadian 2026-08-26 di produksi: `EACCES: permission denied, mkdir
 * '/app/.data'`. Kontainer berjalan sebagai pengguna non-root (`marlin`),
 * sedangkan `/app` dibuat root oleh `WORKDIR` — jadi berkas grup yang sudah
 * berhasil diunduh dibuang lagi tepat di langkah terakhir. Direktorinya kini
 * disiapkan di Dockerfile, tapi itu saja tidak cukup: `LAMPIRAN_DIR` bisa
 * diarahkan ke tempat yang tidak boleh ditulis, dan lingkungan lain bisa
 * memasang berkas sistem read-only.
 *
 * Cadangannya `os.tmpdir()`. Itu bukan penurunan mutu: simpanan lokal memang
 * SUDAH bersifat sementara (hilang tiap redeploy) dan hanya persinggahan
 * sebelum berkas yang dikonfirmasi naik ke R2. Kehilangan berkas yang sudah di
 * tangan jauh lebih mahal daripada menyimpannya di tempat yang lebih fana.
 */
let catatanCadangan: { utama: string; cadangan: string; kode: string } | null = null;

export async function siapkanDirektoriLampiran(): Promise<string> {
  const utama = direktoriLampiran();
  try {
    await mkdir(utama, { recursive: true });
    catatanCadangan = null;
    return utama;
  } catch (err) {
    const kode = (err as { code?: string } | null)?.code;
    if (kode !== "EACCES" && kode !== "EPERM" && kode !== "EROFS") throw err;
    const cadangan = join(tmpdir(), "marlin-lampiran");
    await mkdir(cadangan, { recursive: true });
    catatanCadangan = { utama, cadangan, kode };
    console.warn(
      `[waha] "${utama}" tidak bisa ditulis (${kode}) – lampiran disimpan sementara di "${cadangan}". ` +
        `Setel LAMPIRAN_DIR ke direktori yang boleh ditulis pengguna aplikasi.`,
    );
    return cadangan;
  }
}

/**
 * KEGAGALAN YANG DIAM ADALAH KEGAGALAN YANG BERULANG.
 *
 * Cadangan `/tmp` di atas menyelamatkan berkas yang sudah di tangan, tapi ia
 * juga menyembunyikan sebabnya: satu-satunya jejaknya adalah SATU baris
 * `console.warn` di log kontainer. Akibatnya persis yang dikeluhkan user
 * 2026-09-03 — *"kenapa file masih hilang saat deploy ulang? padahal di
 * production sudah ada volume khusus?!"*: volume terpasang, tapi tidak bisa
 * ditulis pengguna aplikasi, jadi berkasnya sepanjang waktu mendarat di `/tmp`
 * yang dibersihkan tiap deploy. Dari layar, keduanya terlihat identik.
 *
 * `periksaSimpananLampiran()` membuat bedanya terbaca dari layar, bukan dari log.
 */
export type SimpananLampiran = {
  /** Direktori yang benar-benar dipakai menulis. */
  dipakai: string;
  /** Yang DIMINTA lewat `LAMPIRAN_DIR` (atau bawaannya). */
  diminta: string;
  /** Bertahan melewati deploy ulang? Hanya benar bila `LAMPIRAN_DIR` disetel DAN bisa ditulis. */
  tahanDeploy: boolean;
  /** Sebab, dalam bahasa manusia. `null` = tidak ada masalah. */
  masalah: string | null;
};

/**
 * Periksa simpanan lampiran SEKARANG — benar-benar mencoba menulis, bukan
 * menebak dari env. Dipakai layar Lampiran Masuk supaya keadaan yang salah
 * mengumumkan dirinya sebelum berkas pertama hilang.
 */
export async function periksaSimpananLampiran(): Promise<SimpananLampiran> {
  const diminta = direktoriLampiran();
  const disetel = !!process.env.LAMPIRAN_DIR;
  let dipakai: string;
  try {
    dipakai = await siapkanDirektoriLampiran();
  } catch (err) {
    return {
      dipakai: diminta,
      diminta,
      tahanDeploy: false,
      masalah: `Simpanan lampiran tidak bisa disiapkan (${
        (err as { code?: string } | null)?.code ?? "galat"
      }). Berkas yang masuk dari grup WhatsApp tidak akan tersimpan.`,
    };
  }

  if (catatanCadangan && dipakai !== diminta) {
    return {
      dipakai,
      diminta,
      tahanDeploy: false,
      masalah:
        `Direktori "${diminta}" tidak bisa ditulis (${catatanCadangan.kode}), jadi lampiran ` +
        `disimpan sementara di "${dipakai}" – dan isinya hilang setiap aplikasi di-deploy ulang. ` +
        `Penyebab tersering: penyimpanan tetap dipasang sebagai milik root, sementara aplikasi ` +
        `berjalan sebagai pengguna biasa.`,
    };
  }

  if (!disetel) {
    return {
      dipakai,
      diminta,
      tahanDeploy: false,
      masalah:
        "LAMPIRAN_DIR belum disetel, jadi lampiran disimpan di dalam kontainer dan hilang " +
        "setiap aplikasi di-deploy ulang. Arahkan ke titik pasang penyimpanan tetap.",
    };
  }

  return { dipakai, diminta, tahanDeploy: true, masalah: null };
}

