import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  bolehMenyetujui,
  nilaiPersetujuan,
  suaraMasihBerlaku,
  type StatusPersetujuan,
  type Suara,
} from "./persetujuan-aturan";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * Persetujuan aktivasi revisi RAB — sisi database (DECISIONS 234).
 *
 * Aturannya ada di `persetujuan-aturan.ts` (modul murni, diuji langsung); di
 * sini hanya pembacaan, penulisan, dan gerbangnya.
 */

export class PersetujuanError extends Error {}

export type RingkasanPersetujuan = StatusPersetujuan & {
  /** Suara yang MASIH berlaku untuk isi draft sekarang. */
  berlaku: { userId: string; nama: string; role: UserRole; approvedAt: Date }[];
  /** Suara yang gugur karena draft berubah setelah disetujui. */
  gugur: { userId: string; nama: string; role: UserRole; approvedAt: Date }[];
};

/** Baca status persetujuan sebuah revisi, lengkap dengan yang sudah gugur. */
export async function ringkasPersetujuan(revisionId: string): Promise<RingkasanPersetujuan> {
  const rev = await db.rabRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { updatedAt: true },
  });
  const rows = await db.rabRevisionApproval.findMany({
    where: { revisionId },
    orderBy: { approvedAt: "asc" },
    select: {
      userId: true,
      role: true,
      approvedAt: true,
      user: { select: { fullName: true } },
    },
  });
  const semua = rows.map((r) => ({
    userId: r.userId,
    nama: r.user.fullName,
    role: r.role,
    approvedAt: r.approvedAt,
  }));
  const berlaku = suaraMasihBerlaku(semua, rev.updatedAt);
  const gugurSet = new Set(berlaku.map((s) => s.userId));
  const status = nilaiPersetujuan(berlaku as Suara[]);
  return {
    ...status,
    berlaku,
    gugur: semua.filter((s) => !gugurSet.has(s.userId)),
  };
}

/**
 * Catat satu suara persetujuan.
 *
 * Menyetujui ULANG setelah draft berubah adalah hal yang wajar — barisnya
 * diperbarui, bukan ditolak sebagai duplikat. Yang tidak wajar adalah satu
 * orang terhitung dua kursi, dan itu dicegah kunci unik (revisionId, userId).
 */
export async function setujuiRevisi(revisionId: string, user: { id: string; role: UserRole }) {
  if (!bolehMenyetujui(user.role)) {
    throw new PersetujuanError(
      "Peran Anda tidak berhak menyetujui aktivasi adendum. " +
        "Yang berhak: Program Director, Area Manager, Project Manager, atau Site Manager.",
    );
  }
  const rev = await db.rabRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { id: true, status: true, revisionNo: true, locationId: true, totalValue: true },
  });
  if (rev.status !== "draft") {
    throw new PersetujuanError(`Revisi #${rev.revisionNo} bukan draft — tidak ada yang perlu disetujui.`);
  }
  await db.rabRevisionApproval.upsert({
    where: { revisionId_userId: { revisionId, userId: user.id } },
    update: { role: user.role, totalValue: rev.totalValue, approvedAt: new Date() },
    create: { revisionId, userId: user.id, role: user.role, totalValue: rev.totalValue },
  });
  await audit(user.id, "rab.revision_approve", "rab_revision", revisionId, {
    locationId: rev.locationId,
    revisionNo: rev.revisionNo,
    role: user.role,
    totalValue: rev.totalValue.toString(),
  });
}

/** Cabut suara sendiri (mis. salah tekan, atau berubah pikiran sebelum aktivasi). */
export async function cabutPersetujuan(revisionId: string, user: { id: string; role: UserRole }) {
  const hapus = await db.rabRevisionApproval.deleteMany({ where: { revisionId, userId: user.id } });
  if (hapus.count === 0) throw new PersetujuanError("Anda belum menyetujui revisi ini.");
  await audit(user.id, "rab.revision_approve_revoke", "rab_revision", revisionId, { role: user.role });
}

/**
 * GERBANG aktivasi — dipanggil SEBELUM `activateRevision`, di setiap jalur.
 *
 * Ditulis sebagai fungsi terpisah, bukan di dalam `activateRevision`, karena
 * jalur impor "Jadikan RAB AKTIF sekarang" juga memakai `activateRevision`
 * untuk REVISI PERTAMA (HPS awal) — dan HPS awal bukan adendum, jadi tidak
 * menuntut empat mata. Yang membutuhkan dua tanda tangan adalah adendum:
 * revisi yang MENGGANTIKAN RAB kontrak yang sudah berjalan.
 */
export async function pastikanBolehAktivasi(revisionId: string): Promise<void> {
  const rev = await db.rabRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { id: true, locationId: true, revisionNo: true },
  });
  const adaAktif = await db.rabRevision.count({
    where: { locationId: rev.locationId, status: "aktif" },
  });
  // Belum ada RAB aktif = ini HPS awal, bukan adendum. Tidak ada kontrak
  // berjalan yang diganti, jadi tidak ada yang perlu ditandatangani berdua.
  if (adaAktif === 0) return;

  const status = await ringkasPersetujuan(revisionId);
  if (status.lengkap) return;
  throw new PersetujuanError(
    `Aktivasi revisi #${rev.revisionNo} butuh persetujuan DUA orang berbeda dan masih kurang: ` +
      `${status.kurang.join(" + ")}. ` +
      `Adendum mengganti RAB kontrak yang berlaku dan menghitung ulang kurva-S — ` +
      `tidak ada peran, termasuk Super Admin, yang boleh melakukannya sendirian.`,
  );
}
