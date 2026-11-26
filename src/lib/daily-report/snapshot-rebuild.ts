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

/**
 * Potret SATU laporan final dibangun ulang dari data hidup – dipakai saat isi
 * laporan final berubah tanpa membuka kuncinya (foto yang dikembalikan ke
 * Foto Cepat, DECISIONS 791). Bukan final → tidak ada yang dibangun.
 */
export async function bangunUlangSnapshotSatu(reportId: string): Promise<boolean> {
  const r = await db.dailyReport.findUnique({ where: { id: reportId }, select: { status: true } });
  if (r?.status !== "final") return false;
  const { buildFinalSnapshot } = await import("./service");
  const snapshot = await buildFinalSnapshot(reportId);
  await db.dailyReport.update({
    where: { id: reportId },
    data: { finalSnapshot: snapshot as unknown as Prisma.InputJsonValue },
  });
  return true;
}
