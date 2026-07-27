/**
 * Bangun ulang `finalSnapshot` laporan harian yang sudah final.
 *
 * Perlu dijalankan SEKALI setelah perbaikan DECISIONS 147: snapshot lama
 * dibekukan memakai kumulatif SELURUH WAKTU (bukan s/d tanggal laporan),
 * sehingga kolom "s/d" mentok 100% dan "s/d lalu" ikut salah. Kode baru sudah
 * benar, tapi snapshot yang terlanjur beku tidak ikut berubah.
 *
 * Pakai:
 *   pnpm tsx scripts/rebuild-daily-snapshots.mts                # semua lokasi
 *   pnpm tsx scripts/rebuild-daily-snapshots.mts <slug-lokasi>  # satu lokasi
 *   DRY_RUN=1 pnpm tsx scripts/rebuild-daily-snapshots.mts      # hanya laporan
 *
 * Aman diulang: menulis ulang snapshot dari data laporan yang sama, tidak
 * mengubah status, volume, maupun data input.
 */
import { db } from "@/lib/db";
import { buildFinalSnapshot } from "@/lib/daily-report/service";
import { jakartaDateKey } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";

const slug = process.argv[2] ?? null;
const dryRun = process.env.DRY_RUN === "1";

async function main() {
  const reports = await db.dailyReport.findMany({
    where: {
      status: "final",
      ...(slug ? { location: { slug } } : {}),
    },
    orderBy: [{ locationId: "asc" }, { reportDate: "asc" }],
    select: { id: true, reportDate: true, location: { select: { slug: true, name: true } } },
  });

  if (reports.length === 0) {
    console.log(slug ? `Tidak ada laporan final di lokasi "${slug}".` : "Tidak ada laporan final.");
    return;
  }
  console.log(
    `${reports.length} laporan final akan dibangun ulang${dryRun ? " (DRY RUN — tidak menulis)" : ""}.`,
  );

  let ok = 0;
  let gagal = 0;
  for (const r of reports) {
    const label = `${r.location.name} ${jakartaDateKey(r.reportDate)}`;
    try {
      const snapshot = await buildFinalSnapshot(r.id);
      if (!dryRun) {
        await db.dailyReport.update({
          where: { id: r.id },
          data: { finalSnapshot: snapshot as unknown as Prisma.InputJsonValue },
        });
      }
      ok++;
      console.log(`  ✓ ${label}`);
    } catch (err) {
      gagal++;
      console.error(`  ✗ ${label}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`Selesai: ${ok} berhasil, ${gagal} gagal.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
