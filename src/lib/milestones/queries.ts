import "server-only";
import { db } from "@/lib/db";
import { PHASE_LABEL, PHASE_ORDER } from "@/lib/documents";
import { jakartaToday } from "@/lib/format";
import type { AdminPhase, DocumentType, MilestoneStatus } from "@/generated/prisma/enums";
import type { BadgeTone } from "@/components/ui/badge";

/** Papan kepatuhan milestone administrasi — grouped per fase. */

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  belum_dimulai: "Belum Dimulai",
  berjalan: "Berjalan",
  menunggu_pihak_lain: "Menunggu Pihak Lain",
  perlu_perbaikan: "Perlu Perbaikan",
  selesai: "Selesai",
  tidak_berlaku: "Tidak Berlaku",
};

export const MILESTONE_STATUS_TONE: Record<MilestoneStatus, BadgeTone> = {
  belum_dimulai: "neutral",
  berjalan: "info",
  menunggu_pihak_lain: "warning",
  perlu_perbaikan: "warning",
  selesai: "success",
  tidak_berlaku: "neutral",
};

export type MilestoneBoardDoc = {
  id: string;
  title: string;
  type: DocumentType;
  uploadedAt: Date;
};

export type MilestoneBoardItem = {
  id: string;
  templateKey: string;
  name: string;
  phase: AdminPhase;
  sortOrder: number;
  status: MilestoneStatus;
  requiresVerification: boolean;
  picUserId: string | null;
  picName: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  verifiedById: string | null;
  verifiedByName: string | null;
  note: string | null;
  isLate: boolean;
  documents: MilestoneBoardDoc[];
};

export type MilestoneBoardPhase = {
  phase: AdminPhase;
  label: string;
  items: MilestoneBoardItem[];
  total: number;
  done: number;
  completenessPct: number;
};

export type MilestoneBoard = {
  total: number;
  done: number;
  late: number;
  completenessPct: number;
  phases: MilestoneBoardPhase[];
};

const DONE_STATUSES: MilestoneStatus[] = ["selesai", "tidak_berlaku"];

/**
 * Papan milestone. Beri locationId untuk papan per lokasi;
 * atau packageId untuk seluruh milestone paket.
 */
export async function milestoneBoard(params: {
  packageId?: string;
  locationId?: string;
}): Promise<MilestoneBoard> {
  if (!params.packageId && !params.locationId) {
    throw new Error("milestoneBoard butuh packageId atau locationId");
  }
  const rows = await db.adminMilestone.findMany({
    where: params.locationId ? { locationId: params.locationId } : { packageId: params.packageId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      templateKey: true,
      name: true,
      phase: true,
      sortOrder: true,
      status: true,
      requiresVerification: true,
      picUserId: true,
      dueDate: true,
      completedAt: true,
      verifiedById: true,
      note: true,
      documents: {
        select: { id: true, title: true, type: true, uploadedAt: true },
        orderBy: { uploadedAt: "desc" },
      },
    },
  });

  // AdminMilestone tidak punya relasi User — join manual PIC & verifikator.
  const userIds = [
    ...new Set(rows.flatMap((r) => [r.picUserId, r.verifiedById]).filter((v): v is string => v !== null)),
  ];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));

  const today = jakartaToday();
  const items: MilestoneBoardItem[] = rows.map((r) => ({
    id: r.id,
    templateKey: r.templateKey,
    name: r.name,
    phase: r.phase,
    sortOrder: r.sortOrder,
    status: r.status,
    requiresVerification: r.requiresVerification,
    picUserId: r.picUserId,
    picName: r.picUserId ? (nameById.get(r.picUserId) ?? null) : null,
    dueDate: r.dueDate,
    completedAt: r.completedAt,
    verifiedById: r.verifiedById,
    verifiedByName: r.verifiedById ? (nameById.get(r.verifiedById) ?? null) : null,
    note: r.note,
    isLate: r.dueDate !== null && r.dueDate < today && !DONE_STATUSES.includes(r.status),
    documents: r.documents,
  }));

  const phases: MilestoneBoardPhase[] = PHASE_ORDER.filter((phase) =>
    items.some((it) => it.phase === phase),
  ).map((phase) => {
    const phaseItems = items.filter((it) => it.phase === phase);
    const done = phaseItems.filter((it) => DONE_STATUSES.includes(it.status)).length;
    return {
      phase,
      label: PHASE_LABEL[phase],
      items: phaseItems,
      total: phaseItems.length,
      done,
      completenessPct: phaseItems.length > 0 ? (done / phaseItems.length) * 100 : 0,
    };
  });

  const done = items.filter((it) => DONE_STATUSES.includes(it.status)).length;
  return {
    total: items.length,
    done,
    late: items.filter((it) => it.isLate).length,
    completenessPct: items.length > 0 ? (done / items.length) * 100 : 0,
    phases,
  };
}
