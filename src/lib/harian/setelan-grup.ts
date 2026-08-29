import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * SAKELAR pengingat laporan harian ke GRUP WhatsApp paket (ketetapan user
 * 2026-08-29, menindaklanjuti pengumuman KKP soal laporan & dokumentasi
 * harian).
 *
 * Terpisah dari sakelar pengingat perorangan, dengan alasan yang sama seperti
 * sakelar laporan mingguan: keduanya menagih ke ORANG YANG BERBEDA. Pengingat
 * perorangan masuk ke HP Site Manager; pesan ini masuk ke grup yang berisi PPK
 * dan konsultan pengawas. Mematikan tagihan internal saat libur bersama tidak
 * boleh diam-diam ikut membungkam yang satunya — dan sebaliknya.
 *
 * **DEFAULT-nya MATI.** Pesan yang tiba-tiba muncul di grup pemberi kerja tanpa
 * ada yang pernah memutuskan begitu adalah hal yang tidak bisa ditarik kembali;
 * yang menyalakannya harus manusia.
 */

export const PENGINGAT_GRUP_KEY = "reminder.daily_group_enabled" as const;

/** Nilai bila setelannya belum pernah disimpan — lihat catatan di atas. */
export const PENGINGAT_GRUP_DEFAULT = false;

/** Apakah penjadwal boleh mengantre & mengirim pengingat ke grup. */
export async function getPengingatGrupAktif(): Promise<boolean> {
  const row = await db.appSetting.findFirst({
    where: { key: PENGINGAT_GRUP_KEY },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  const v = row?.value.trim();
  if (v == null || v === "") return PENGINGAT_GRUP_DEFAULT;
  return v === "1" || v.toLowerCase() === "true";
}

/** Simpan sakelar (berlaku hari ini, Asia/Jakarta). */
export async function setPengingatGrupAktif(aktif: boolean): Promise<void> {
  const effectiveFrom = jakartaToday();
  const value = aktif ? "1" : "0";
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key: PENGINGAT_GRUP_KEY, effectiveFrom } },
    update: { value },
    create: { key: PENGINGAT_GRUP_KEY, value, effectiveFrom },
  });
}
