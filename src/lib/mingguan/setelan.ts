import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * SAKELAR laporan mingguan otomatis ke grup WhatsApp.
 *
 * Pola yang sama persis dengan sakelar pengingat harian (`harian/setelan.ts`):
 * disimpan di `AppSetting` ber-tanggal-berlaku, jadi perubahannya punya jejak
 * waktu dan bisa ditelusuri, bukan menghilang begitu diganti.
 *
 * **Sakelar terpisah, bukan menumpang sakelar harian.** Keduanya menumpang
 * putaran cron yang sama tetapi menagih hal yang berbeda ke orang yang berbeda:
 * pengingat harian mengejar Site Manager yang belum mengisi, laporan mingguan
 * melapor ke grup yang berisi PPK dan konsultan. Mematikan tagihan internal
 * karena libur bersama tidak boleh diam-diam ikut menghentikan laporan resmi ke
 * pemberi kerja.
 *
 * **DEFAULT-nya MATI**, berbeda dari pengingat harian yang default-nya nyala.
 * Alasannya: pengingat harian sudah berjalan sebelum sakelarnya ada, jadi
 * "belum pernah disentuh" berarti "seperti kemarin". Laporan mingguan ini
 * BARU — menyalakannya secara diam-diam berarti pesan tiba-tiba muncul di grup
 * pemberi kerja tanpa ada yang pernah memutuskan begitu. Yang mengirim laporan
 * resmi harus manusia yang menekan sakelarnya.
 */

export const MINGGUAN_KEY = "report.weekly_wa_enabled" as const;

/** Nilai bila setelannya belum pernah disimpan — lihat catatan di atas. */
export const MINGGUAN_DEFAULT = false;

/** Apakah penjadwal boleh mengirim laporan mingguan otomatis. */
export async function getMingguanAktif(): Promise<boolean> {
  const row = await db.appSetting.findFirst({
    where: { key: MINGGUAN_KEY },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  const v = row?.value.trim();
  if (v == null || v === "") return MINGGUAN_DEFAULT;
  return v === "1" || v.toLowerCase() === "true";
}

/** Simpan sakelar (berlaku hari ini, Asia/Jakarta). */
export async function setMingguanAktif(aktif: boolean): Promise<void> {
  const effectiveFrom = jakartaToday();
  const value = aktif ? "1" : "0";
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key: MINGGUAN_KEY, effectiveFrom } },
    update: { value },
    create: { key: MINGGUAN_KEY, value, effectiveFrom },
  });
}
