import "server-only";
import { db } from "@/lib/db";
import { jakartaDateKey } from "@/lib/format";
import { refKeyHarian } from "@/lib/gdrive/kirim";
import {
  ringkasDrive,
  ringkasKirim,
  type DriveGagal,
  type DriveSukses,
  type RingkasKirim,
} from "./riwayat-harian";

/**
 * KUMPULAN CATATAN PENYERAHAN LAPORAN HARIAN (DECISIONS 406).
 *
 * Aturan murninya di `riwayat-harian.ts`; di sini hanya pengambilan datanya.
 *
 * Dua tingkat dengan sengaja:
 *
 * - **Angka ringkas** dihitung dari SELURUH laporan final lokasi itu, bukan dari
 *   tiga puluh yang kebetulan tampil. "Belum dikirim: 4" yang diam-diam berarti
 *   "4 dari 30 terakhir" akan dibaca sebagai "4 dari semuanya", dan orang akan
 *   berhenti mencari setelah membereskan empat.
 * - **Rincian per baris** hanya untuk yang ditampilkan — log Drive satu hari
 *   bisa belasan baris (PDF + tiap foto), dan menariknya untuk setahun penuh
 *   demi menghias daftar sepanjang layar adalah pemborosan yang tidak dibayar
 *   siapa pun.
 */

export type BarisHarian = {
  id: string;
  dateKey: string;
  reportDate: Date;
  jumlahItem: number;
  difinalkan: { pada: Date; oleh: string | null } | null;
  wa: { pada: Date; oleh: string | null } | null;
  drive: DriveSukses | null;
  driveGagal: DriveGagal | null;
  unduh: { jumlah: number; pada: Date } | null;
};

export type RiwayatHarian = {
  baris: BarisHarian[];
  ringkas: RingkasKirim;
  /** Berapa laporan final yang TIDAK muat di daftar – disebut, bukan didiamkan. */
  tersembunyi: number;
};

export async function ambilRiwayatHarian(input: {
  locationId: string;
  slug: string;
  batas?: number;
}): Promise<RiwayatHarian> {
  const { locationId, slug } = input;
  const batas = input.batas ?? 30;

  const [semua, refDrive] = await Promise.all([
    db.dailyReport.findMany({
      where: { locationId, status: "final" },
      orderBy: { reportDate: "desc" },
      select: { id: true, reportDate: true, waSentAt: true },
    }),
    // Cukup KUNCINYA: berapa hari yang pernah sampai ke Drive, bukan berapa
    // berkasnya. Log per berkas ditarik belakangan, hanya untuk yang tampil.
    db.gDriveUpload.groupBy({
      by: ["refKey"],
      where: { locationId, kind: "laporan_harian", status: "sukses" },
    }),
  ]);

  const adaDiDrive = new Set(refDrive.map((r) => r.refKey));
  const kunci = (d: Date) => refKeyHarian(slug, jakartaDateKey(d));

  const ringkas = ringkasKirim(
    semua.map((r) => ({ drive: adaDiDrive.has(kunci(r.reportDate)), wa: !!r.waSentAt })),
  );

  const teratas = semua.slice(0, batas);
  if (teratas.length === 0) return { baris: [], ringkas, tersembunyi: 0 };

  const ids = teratas.map((r) => r.id);
  const refKeys = teratas.map((r) => kunci(r.reportDate));

  const [rinci, logDrive, unduhan] = await Promise.all([
    db.dailyReport.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        reportDate: true,
        waSentAt: true,
        waSentById: true,
        finalizedAt: true,
        finalizedById: true,
        _count: { select: { items: true } },
      },
    }),
    db.gDriveUpload.findMany({
      where: { locationId, kind: "laporan_harian", refKey: { in: refKeys } },
      select: {
        refKey: true,
        status: true,
        createdAt: true,
        fileName: true,
        webLink: true,
        error: true,
      },
    }),
    /*
     * Unduhan PDF dibaca dari audit log, bukan dari kolom penghitung sendiri.
     * Alasannya bukan kemalasan: audit sudah append-only dan tidak bisa disunting,
     * jadi angkanya tidak mungkin dirapikan belakangan — dan tidak ada kolom
     * agregat baru yang harus dijaga tetap benar (CLAUDE.md: agregat selalu
     * derived).
     */
    db.auditLog.groupBy({
      by: ["resourceId"],
      where: { action: "report.pdf_unduh", resourceType: "daily_report", resourceId: { in: ids } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ]);

  const idPengguna = [
    ...new Set(
      rinci.flatMap((r) => [r.waSentById, r.finalizedById].filter((v): v is string => !!v)),
    ),
  ];
  const nama = new Map<string, string>(
    idPengguna.length
      ? (
          await db.user.findMany({
            where: { id: { in: idPengguna } },
            select: { id: true, fullName: true },
          })
        ).map((u) => [u.id, u.fullName])
      : [],
  );

  const perRef = new Map<string, typeof logDrive>();
  for (const l of logDrive) {
    const daftar = perRef.get(l.refKey);
    if (daftar) daftar.push(l);
    else perRef.set(l.refKey, [l]);
  }
  const perUnduh = new Map(unduhan.map((u) => [u.resourceId ?? "", u]));

  const baris: BarisHarian[] = rinci
    .sort((a, b) => b.reportDate.getTime() - a.reportDate.getTime())
    .map((r) => {
      const dateKey = jakartaDateKey(r.reportDate);
      const { sukses, gagal } = ringkasDrive(perRef.get(refKeyHarian(slug, dateKey)) ?? []);
      const u = perUnduh.get(r.id);
      return {
        id: r.id,
        dateKey,
        reportDate: r.reportDate,
        jumlahItem: r._count.items,
        difinalkan: r.finalizedAt
          ? { pada: r.finalizedAt, oleh: r.finalizedById ? (nama.get(r.finalizedById) ?? null) : null }
          : null,
        wa: r.waSentAt
          ? { pada: r.waSentAt, oleh: r.waSentById ? (nama.get(r.waSentById) ?? null) : null }
          : null,
        drive: sukses,
        driveGagal: gagal,
        unduh: u?._max.createdAt ? { jumlah: u._count._all, pada: u._max.createdAt } : null,
      };
    });

  return { baris, ringkas, tersembunyi: Math.max(0, semua.length - baris.length) };
}
