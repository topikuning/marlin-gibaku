import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { weekDateRange } from "@/lib/progress-calc";
import { jakartaToday } from "@/lib/format";
import type { FinalSnapshot } from "@/lib/daily-report/service";
import { Prisma } from "@/generated/prisma/client";

/**
 * Migrasi data SATU KALI (DECISIONS 430): membekukan RENTANG TANGGAL periode
 * pada snapshot blanko final LAMA — yang dibuat sebelum DECISIONS 427c, saat
 * kolom `periodStartKey`/`periodEndKey` belum ada.
 *
 * Kenapa perlu: snapshot lama hanya membekukan NOMOR minggu, dan penyaji cetak
 * menurunkan rentang tanggalnya saat mencetak. Begitu mode periode minggu
 * kontrak berubah (DECISIONS 429 menjadikan senin_minggu default), rentang
 * hasil derivasi memakai mode BARU sementara nomornya beku dari era 7-hari —
 * blanko bisa menyebut periode yang TIDAK MEMUAT tanggal laporannya sendiri.
 *
 * Kenapa `tujuh_hari` yang dipakai, bukan mode kontrak sekarang: sebelum 427c
 * `buildFinalSnapshot` menghitung nomor minggu dengan rumus 7-hari yang
 * ditulis langsung — `floor((tanggal − SPMK) / 7 hari) + 1` — TERLEPAS dari
 * mode kontraknya. Jadi setiap snapshot tanpa rentang beku pasti bernomor
 * minggu versi 7-hari, dan rentang yang benar untuknya adalah rentang 7-hari.
 *
 * Yang TIDAK dilakukan: menghitung ulang isi snapshot. Blanko final adalah
 * dokumen yang sudah diteken — angka rencana, deviasi, volume, dan nomor
 * minggunya tidak boleh berubah. Yang ditambahkan hanyalah rentang tanggal
 * yang selama ini diturunkan saat cetak, dibekukan apa adanya. Bandingkan
 * `rebuildFinalSnapshots` (Sistem) yang memang menghitung ulang segalanya —
 * itu alat lain untuk keperluan lain.
 *
 * Idempoten: penanda AppSetting + filter "hanya yang belum punya rentang".
 * Boot terpotong ⇒ penanda belum tertulis, sisanya dilanjutkan boot berikutnya.
 */

const MARKER_KEY = "migrasi.snapshot_periode_backfill";
const BATCH = 200;

export type HasilBackfillPeriode = {
  status: "sudah" | "selesai";
  diperiksa: number;
  diisi: number;
  dilewati: number;
};

export async function backfillPeriodeSnapshotLama(): Promise<HasilBackfillPeriode> {
  const sudah = await db.appSetting.findFirst({ where: { key: MARKER_KEY }, select: { id: true } });
  if (sudah) return { status: "sudah", diperiksa: 0, diisi: 0, dilewati: 0 };

  let diperiksa = 0;
  let diisi = 0;
  let dilewati = 0;
  let cursor: string | undefined;

  for (;;) {
    const batch = await db.dailyReport.findMany({
      where: { status: "final", finalSnapshot: { not: Prisma.DbNull } },
      orderBy: { id: "asc" },
      take: BATCH,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      select: {
        id: true,
        finalSnapshot: true,
        location: { select: { package: { select: { contract: { select: { startDate: true } } } } } },
      },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const r of batch) {
      diperiksa++;
      const snap = r.finalSnapshot as unknown as FinalSnapshot | null;
      // Sudah punya rentang beku (snapshot pasca-427c) → jangan disentuh.
      if (!snap || (snap.periodStartKey && snap.periodEndKey)) {
        dilewati++;
        continue;
      }
      const startDate = r.location.package.contract?.startDate ?? null;
      // Tanpa SPMK atau tanpa nomor minggu tidak ada rentang yang bisa dibekukan
      // — blanko-nya pun memang tidak menyebut periode.
      if (!startDate || snap.weekNo == null) {
        dilewati++;
        continue;
      }
      const rentang = weekDateRange(startDate, snap.weekNo, "tujuh_hari");
      await db.dailyReport.update({
        where: { id: r.id },
        data: {
          finalSnapshot: {
            ...snap,
            periodStartKey: rentang.start.toISOString().slice(0, 10),
            periodEndKey: rentang.end.toISOString().slice(0, 10),
          } as unknown as Prisma.InputJsonValue,
        },
      });
      diisi++;
    }
  }

  await db.appSetting.create({
    data: {
      key: MARKER_KEY,
      value: JSON.stringify({ diperiksa, diisi, dilewati }),
      effectiveFrom: jakartaToday(),
    },
  });
  await audit(null, "daily_report.snapshot_periode_backfill", "app_setting", null, {
    diperiksa,
    diisi,
    dilewati,
  });
  return { status: "selesai", diperiksa, diisi, dilewati };
}
