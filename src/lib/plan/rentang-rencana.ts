import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { weekDateRange, type WeekPeriodMode } from "@/lib/progress-calc";

/**
 * Rentang tanggal RENCANA MINGGUAN mengikuti grid minggu kontrak yang berlaku.
 *
 * `WeeklyPlan` menyimpan nomor minggu DAN rentang tanggalnya. Ada pembaca yang
 * mencari lewat nomor (halaman rencana mingguan) dan ada yang lewat tanggal
 * (blanko harian: weekStart ≤ tanggal ≤ weekEnd). Begitu grid berubah – ganti
 * periode minggu, ganti SPMK/durasi, atau lokasi pindah paket – rentang lama
 * membuat kedua pembaca menunjuk rencana yang berbeda untuk minggu yang sama.
 *
 * Rencana tetap milik NOMOR minggunya ("rencana M12" tetap M12); rentangnya
 * dihitung ulang dari grid baru. Membagi rencana menurut tanggal tidak masuk
 * akal: target volume satu minggu tidak bisa dipecah ke dua minggu.
 * Dipakai pindah lokasi (DECISIONS 579) dan perubahan grid kontrak (DECISIONS 708).
 */
export async function selaraskanRentangRencana(
  locationIds: string[],
  kontrak: { startDate: Date; endDate: Date | null; weekMode: WeekPeriodMode },
  client: Prisma.TransactionClient | typeof db = db,
): Promise<{ dihitung: number; diubah: number }> {
  if (locationIds.length === 0) return { dihitung: 0, diubah: 0 };
  const rencana = await client.weeklyPlan.findMany({
    where: { locationId: { in: locationIds } },
    select: { id: true, weekNumber: true, weekStart: true, weekEnd: true },
  });
  let diubah = 0;
  for (const r of rencana) {
    const { start, end } = weekDateRange(kontrak.startDate, r.weekNumber, kontrak.weekMode, kontrak.endDate);
    if (start.getTime() === r.weekStart.getTime() && end.getTime() === r.weekEnd.getTime()) continue;
    await client.weeklyPlan.update({ where: { id: r.id }, data: { weekStart: start, weekEnd: end } });
    diubah++;
  }
  // `dihitung` = semua rencana yang dicocokkan ke grid; `diubah` = yang tanggalnya memang bergeser.
  return { dihitung: rencana.length, diubah };
}
