import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Bangun ulang `finalSnapshot` laporan-laporan FINAL yang angkanya jadi basi
 * karena sesuatu berubah di belakangnya.
 *
 * Snapshot membekukan `volumeBefore`, `volumeCumulative`, dan blok progress
 * as-of tanggalnya. Kalau volume laporan yang LEBIH AWAL berubah — koreksi
 * sesudah buka kunci, pemindahan tanggal, penyesuaian volume saat aktivasi
 * adendum — maka seluruh laporan final SESUDAHNYA membekukan kumulatif yang
 * MARLIN sendiri sudah tahu salah. Membiarkannya basi berarti sengaja mencetak
 * angka yang salah (DECISIONS 415).
 *
 * Satu snapshot yang gagal dibangun tidak boleh membatalkan pekerjaan yang
 * sudah jadi — yang dikembalikan jumlah yang BERHASIL, supaya pemanggil bisa
 * mengatakannya kepada user.
 */
export async function bangunUlangSnapshotFinal(
  locationId: string,
  rentang: { sejak?: Date; sebelum?: Date; kecualiId?: string },
): Promise<number> {
  const { buildFinalSnapshot } = await import("./service");
  const terdampak = await db.dailyReport.findMany({
    where: {
      locationId,
      status: "final",
      ...(rentang.kecualiId ? { id: { not: rentang.kecualiId } } : {}),
      ...(rentang.sejak || rentang.sebelum
        ? {
            reportDate: {
              ...(rentang.sejak ? { gte: rentang.sejak } : {}),
              ...(rentang.sebelum ? { lt: rentang.sebelum } : {}),
            },
          }
        : {}),
    },
    orderBy: { reportDate: "asc" },
    select: { id: true },
  });

  let jadi = 0;
  for (const r of terdampak) {
    try {
      const snapshot = await buildFinalSnapshot(r.id);
      await db.dailyReport.update({
        where: { id: r.id },
        data: { finalSnapshot: snapshot as unknown as Prisma.InputJsonValue },
      });
      jadi++;
    } catch {
      /* satu snapshot gagal tidak membatalkan sisanya */
    }
  }
  return jadi;
}
