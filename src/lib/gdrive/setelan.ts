import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * SAKELAR unggah otomatis ke Google Drive KKP (DECISIONS 313).
 *
 * Pola sama dengan sakelar laporan mingguan WA (`mingguan/setelan.ts`):
 * disimpan di `AppSetting` ber-tanggal-berlaku supaya perubahannya punya jejak
 * waktu, bukan menghilang begitu diganti.
 *
 * **DEFAULT-nya MATI**, dan alasannya sama persis dengan DECISIONS 311: folder
 * tujuannya BUKAN milik MARLIN — itu Drive pemberi kerja. Menyalakannya
 * diam-diam saat deploy berarti berkas tiba-tiba bermunculan di folder KKP
 * tanpa pernah ada orang yang memutuskan begitu. Yang menaruh dokumen resmi di
 * tempat pemberi kerja harus manusia yang menekan sakelarnya.
 *
 * Sakelar ini mematikan PENJADWAL, bukan kemampuan mengunggah: tombol manual di
 * papan status harian & halaman laporan lokasi tetap jalan.
 */

export const GDRIVE_OTOMATIS_KEY = "gdrive.auto_upload_enabled" as const;

/** Nilai bila setelannya belum pernah disimpan — lihat catatan di atas. */
export const GDRIVE_OTOMATIS_DEFAULT = false;

export async function getGDriveOtomatisAktif(): Promise<boolean> {
  const row = await db.appSetting.findFirst({
    where: { key: GDRIVE_OTOMATIS_KEY },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  const v = row?.value.trim();
  if (v == null || v === "") return GDRIVE_OTOMATIS_DEFAULT;
  return v === "1" || v.toLowerCase() === "true";
}

/** Simpan sakelar (berlaku hari ini, Asia/Jakarta). */
export async function setGDriveOtomatisAktif(aktif: boolean): Promise<void> {
  const effectiveFrom = jakartaToday();
  const value = aktif ? "1" : "0";
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key: GDRIVE_OTOMATIS_KEY, effectiveFrom } },
    update: { value },
    create: { key: GDRIVE_OTOMATIS_KEY, value, effectiveFrom },
  });
}
