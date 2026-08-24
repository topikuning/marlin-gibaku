import "server-only";
import type { ReportVerifStatus } from "@/generated/prisma/enums";
import { auditIn } from "@/lib/audit";
import { requestIp } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";

/**
 * Verifikasi EKSTERNAL laporan harian oleh Wakil PPK (DECISIONS 426).
 *
 * APPEND-ONLY: tiap aksi = baris `ReportVerification` baru; baris terakhir =
 * keadaan terkini. TIDAK menyentuh `DailyReport.status` dan TIDAK mengubah
 * satu pun angka resmi — ini jejak pemeriksaan pemberi kerja, bukan gerbang
 * perhitungan.
 */

export class VerifikasiError extends Error {}

export async function verifyReportExternal(
  reportId: string,
  status: ReportVerifStatus,
  note: string | null,
  userId: string,
): Promise<void> {
  const report = await db.dailyReport.findUnique({ where: { id: reportId }, select: { status: true } });
  if (!report) throw new VerifikasiError("Laporan tidak ditemukan.");
  if (!(COUNTED_REPORT_STATUSES as readonly string[]).includes(report.status)) {
    // Draft / perlu koreksi masih bisa berubah — belum ada yang bisa diperiksa.
    throw new VerifikasiError("Laporan masih draft/perlu koreksi – belum bisa diverifikasi.");
  }
  if ((status === "perlu_klarifikasi" || status === "ditolak") && !note) {
    throw new VerifikasiError("Catatan wajib diisi untuk hasil selain Diverifikasi.");
  }
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    const row = await tx.reportVerification.create({
      data: { reportId, status, note, verifiedById: userId },
      select: { id: true },
    });
    await auditIn(tx, userId, "report.verify_external", "daily_report", reportId, { status, note, verificationId: row.id }, ip);
  });
}

/** Baris verifikasi TERAKHIR per laporan (null = belum diperiksa). */
export async function latestVerification(reportId: string) {
  return db.reportVerification.findFirst({
    where: { reportId },
    orderBy: { createdAt: "desc" },
  });
}

/** Riwayat verifikasi satu laporan, terbaru dulu, + nama pemeriksa. */
export async function riwayatVerifikasi(reportId: string) {
  const rows = await db.reportVerification.findMany({
    where: { reportId },
    orderBy: { createdAt: "desc" },
  });
  const ids = [...new Set(rows.map((r) => r.verifiedById))];
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    : [];
  const nama = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({ ...r, verifiedByName: nama.get(r.verifiedById) ?? "(tidak dikenal)" }));
}
