import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import type { ImportKind, ImportStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import type { BarisImpor } from "./labels";

// Label, tone, dan aturan status tinggal di `labels.ts` (bebas `db`) supaya
// bisa diuji tanpa database; di-ekspor ulang di sini agar pemakai halaman
// cukup mengimpor satu modul.
export {
  LABEL_JENIS_IMPOR,
  LABEL_STATUS_IMPOR,
  TONE_STATUS_IMPOR,
  ringkasImpor,
  type BarisImpor,
} from "./labels";

/**
 * Riwayat impor yang BOLEH dilihat pengguna ini.
 *
 * Dua pagar, bukan satu. Pertama `orgId` — riwayat tenant lain bukan urusan
 * siapa pun di sini. Kedua **scope lokasi**: pekerjaan yang menempel pada satu
 * lokasi hanya terlihat oleh yang berhak atas lokasi itu, memakai helper yang
 * sama dengan seluruh aplikasi (`locationScopeWhere`) supaya aturannya tidak
 * bercabang. Pekerjaan tanpa lokasi (master lokasi, dokumen Drive) bersifat
 * seorganisasi dan ikut tampil — menyembunyikannya akan membuat halaman ini
 * kosong bagi orang yang justru menjalankannya.
 */
export const daftarImpor = cache(async function daftarImpor(
  user: SessionUser,
  locIds: string[] | null,
  batas = 100,
): Promise<BarisImpor[]> {
  const jobs = await db.importJob.findMany({
    where: {
      orgId: user.orgId,
      OR: [{ locationId: null }, { location: locationScopeWhere(user, locIds) }],
    },
    orderBy: { startedAt: "desc" },
    take: batas,
    select: {
      id: true,
      kind: true,
      status: true,
      fileName: true,
      fileBytes: true,
      rowsRead: true,
      rowsAccepted: true,
      rowsRejected: true,
      message: true,
      startedAt: true,
      user: { select: { fullName: true } },
      location: { select: { name: true } },
      _count: { select: { issues: true } },
    },
  });

  return jobs.map((j) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    fileName: j.fileName,
    fileBytes: j.fileBytes,
    rowsRead: j.rowsRead,
    rowsAccepted: j.rowsAccepted,
    rowsRejected: j.rowsRejected,
    message: j.message,
    startedAt: j.startedAt,
    olehNama: j.user?.fullName ?? null,
    lokasiNama: j.location?.name ?? null,
    jumlahMasalah: j._count.issues,
  }));
});

export type MasalahBaris = {
  id: string;
  severity: "tolak" | "peringatan";
  rowNumber: number | null;
  column: string | null;
  value: string | null;
  message: string;
};

/**
 * Rincian satu pekerjaan impor. Mengambil `orgId` pemanggil sebagai SYARAT,
 * bukan sekadar memfilter sesudahnya: id pekerjaan itu tebakan yang murah, dan
 * halaman rincian yang menerima id apa pun adalah pintu ke riwayat tenant lain.
 */
export async function rincianImpor(
  user: SessionUser,
  jobId: string,
): Promise<{ masalah: MasalahBaris[] } | null> {
  const job = await db.importJob.findFirst({
    where: { id: jobId, orgId: user.orgId },
    select: {
      issues: {
        orderBy: [{ severity: "asc" }, { rowNumber: "asc" }],
        select: { id: true, severity: true, rowNumber: true, column: true, value: true, message: true },
      },
    },
  });
  if (!job) return null;
  return { masalah: job.issues };
}
