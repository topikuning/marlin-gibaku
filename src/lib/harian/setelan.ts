import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * SAKELAR pengingat laporan harian otomatis (permintaan user 2026-08-05:
 * "aku perlu flag disable dan enable pengingat harian").
 *
 * Disimpan di `AppSetting` ber-tanggal-berlaku, pola yang sama dengan WAHA,
 * branding, dan kebijakan pengendalian — jadi perubahannya punya jejak waktu
 * dan bisa ditelusuri, bukan menghilang begitu diganti.
 *
 * ### Dua hal yang SENGAJA tidak ikut dimatikan
 *
 * 1. **Tombol manual admin.** Sakelar ini mematikan penjadwal, bukan kemampuan
 *    menagih. Admin yang mematikan pengingat otomatis karena libur bersama
 *    tetap harus bisa menagih satu orang yang lokasinya jalan terus — mengunci
 *    itu berarti sakelar ini memutuskan sesuatu yang bukan haknya.
 * 2. **Aktivasi SPMK jatuh tempo.** Ia menumpang putaran cron yang sama tetapi
 *    bukan pengingat: mematikannya akan membuat paket tidak naik ke
 *    `pelaksanaan` pada tanggalnya, dan itu merusak angka — kurva-S, deviasi,
 *    dan seluruh laporan ikut salah. Sakelar pengingat tidak boleh punya
 *    kekuasaan sebesar itu.
 *
 * DEFAULT-nya **NYALA**, dan itu keputusan sadar: sebelum sakelar ini ada,
 * pengingat memang selalu berjalan. Setelan yang belum pernah disentuh harus
 * berarti "seperti kemarin", bukan diam-diam mematikan tagihan ke lapangan.
 */

export const PENGINGAT_KEY = "reminder.daily_enabled" as const;

/** Nilai bila setelannya belum pernah disimpan — lihat catatan di atas. */
export const PENGINGAT_DEFAULT = true;

/** Apakah penjadwal harian boleh mengirim pengingat. */
export async function getPengingatAktif(): Promise<boolean> {
  const row = await db.appSetting.findFirst({
    where: { key: PENGINGAT_KEY },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  const v = row?.value.trim();
  if (v == null || v === "") return PENGINGAT_DEFAULT;
  return v === "1" || v.toLowerCase() === "true";
}

/** Simpan sakelar (berlaku hari ini, Asia/Jakarta). */
export async function setPengingatAktif(aktif: boolean): Promise<void> {
  const effectiveFrom = jakartaToday();
  const value = aktif ? "1" : "0";
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key: PENGINGAT_KEY, effectiveFrom } },
    update: { value },
    create: { key: PENGINGAT_KEY, value, effectiveFrom },
  });
}
