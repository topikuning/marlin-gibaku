import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { EvidenceVerifStatus, FindingCategory, FindingSource, FindingStatus, IssueSeverity } from "@/generated/prisma/enums";
import { auditIn } from "@/lib/audit";
import { requestIp } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { canTransitionFinding, FINDING_STATUS_LABEL } from "@/lib/lifecycle";

/**
 * Logika bisnis TEMUAN (DECISIONS 426). Pola lapisan sama dengan
 * `daily-report/service.ts`: otorisasi (capability + lokasi) hidup di
 * `actions.ts`; modul ini menerima `userId` eksplisit supaya bisa diuji
 * langsung. Identitas selalu dari sesi, tidak pernah dari input klien.
 */

export class FindingError extends Error {}

export type CreateFindingInput = {
  locationId: string;
  source?: FindingSource;
  inspectionId?: string | null;
  reportId?: string | null;
  lineageKey?: string | null;
  workItemName?: string | null;
  category: FindingCategory;
  severity: IssueSeverity;
  title: string;
  description?: string | null;
  /** Tanggal temuan (YYYY-MM-DD, tanggal kerja Asia/Jakarta). */
  findingDateKey: string;
  dueDateKey?: string | null;
  assignedToId?: string | null;
  assignedName?: string | null;
};

function toDate(key: string): Date {
  // Kolom @db.Date — pola yang sama dengan reportDate: tengah malam UTC.
  return new Date(`${key}T00:00:00Z`);
}

export async function createFinding(input: CreateFindingInput, userId: string): Promise<{ id: string }> {
  const ip = await requestIp();
  return db.$transaction(async (tx) => {
    const finding = await tx.finding.create({
      data: {
        locationId: input.locationId,
        source: input.source ?? "manual",
        inspectionId: input.inspectionId ?? null,
        reportId: input.reportId ?? null,
        lineageKey: input.lineageKey ?? null,
        workItemName: input.workItemName ?? null,
        category: input.category,
        severity: input.severity,
        title: input.title,
        description: input.description ?? null,
        findingDate: toDate(input.findingDateKey),
        dueDate: input.dueDateKey ? toDate(input.dueDateKey) : null,
        assignedToId: input.assignedToId ?? null,
        assignedName: input.assignedName ?? null,
        raisedById: userId,
      },
      select: { id: true },
    });
    await tx.findingStatusHistory.create({
      data: { findingId: finding.id, fromStatus: null, toStatus: "baru", changedById: userId },
    });
    await auditIn(tx, userId, "finding.create", "finding", finding.id, {
      locationId: input.locationId,
      severity: input.severity,
      category: input.category,
      source: input.source ?? "manual",
    }, ip);
    return finding;
  });
}

/**
 * Transisi status temuan — SATU pintu. Optimistic lock pada status (update
 * bersyarat), histori append-only + audit di TRANSAKSI YANG SAMA (AUDIT-01).
 */
async function transition(
  tx: Prisma.TransactionClient,
  findingId: string,
  to: FindingStatus,
  userId: string,
  note: string | null,
  auditAction: string,
  ip: string | undefined,
  extraData: Prisma.FindingUpdateInput = {},
): Promise<void> {
  const finding = await tx.finding.findUnique({ where: { id: findingId }, select: { status: true } });
  if (!finding) throw new FindingError("Temuan tidak ditemukan.");
  if (!canTransitionFinding(finding.status, to)) {
    throw new FindingError(
      `Temuan berstatus ${FINDING_STATUS_LABEL[finding.status]} tidak bisa dipindah ke ${FINDING_STATUS_LABEL[to]}.`,
    );
  }
  const updated = await tx.finding.updateMany({
    where: { id: findingId, status: finding.status },
    data: { status: to, ...(extraData as Prisma.FindingUpdateManyMutationInput) },
  });
  if (updated.count !== 1) throw new FindingError("Status temuan berubah di tengah jalan – muat ulang lalu coba lagi.");
  await tx.findingStatusHistory.create({
    data: { findingId, fromStatus: finding.status, toStatus: to, changedById: userId, note },
  });
  await auditIn(tx, userId, auditAction, "finding", findingId, { from: finding.status, to, note }, ip);
}

/** Verifikator meminta klarifikasi — pertanyaan wajib. */
export async function askClarification(
  findingId: string,
  question: string,
  dueDateKey: string | null,
  userId: string,
): Promise<void> {
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    await tx.findingClarification.create({
      data: { findingId, question, dueDate: dueDateKey ? toDate(dueDateKey) : null, askedById: userId },
    });
    await transition(tx, findingId, "menunggu_klarifikasi", userId, question, "finding.clarify", ip);
  });
}

/** Pelaksana menjawab klarifikasi → temuan kembali ditindaklanjuti. */
export async function respondClarification(clarificationId: string, response: string, userId: string): Promise<void> {
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    const clar = await tx.findingClarification.findUnique({
      where: { id: clarificationId },
      select: { id: true, findingId: true, response: true },
    });
    if (!clar) throw new FindingError("Klarifikasi tidak ditemukan.");
    if (clar.response) throw new FindingError("Klarifikasi ini sudah dijawab.");
    await tx.findingClarification.update({
      where: { id: clarificationId },
      data: { response, respondedById: userId, respondedAt: new Date() },
    });
    await transition(tx, clar.findingId, "ditindaklanjuti", userId, response, "finding.respond", ip);
  });
}

/** Pelaksana mencatat tindak lanjut. Status ikut pindah bila masih baru/klarifikasi/dibuka kembali. */
export async function addFollowUp(findingId: string, note: string, userId: string): Promise<void> {
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    const finding = await tx.finding.findUnique({ where: { id: findingId }, select: { status: true } });
    if (!finding) throw new FindingError("Temuan tidak ditemukan.");
    await tx.findingNote.create({ data: { findingId, note, createdById: userId } });
    if (finding.status === "ditindaklanjuti" || finding.status === "menunggu_verifikasi") {
      // Catatan tambahan tanpa transisi — tetap diaudit.
      await auditIn(tx, userId, "finding.respond", "finding", findingId, { note }, ip);
    } else {
      await transition(tx, findingId, "ditindaklanjuti", userId, note, "finding.respond", ip);
    }
  });
}

/** Pelaksana menyatakan selesai → menunggu verifikasi penutupan. */
export async function submitForVerification(findingId: string, note: string | null, userId: string): Promise<void> {
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    await transition(tx, findingId, "menunggu_verifikasi", userId, note, "finding.submit_verify", ip);
  });
}

/** Verifikator MENUTUP temuan — catatan wajib (riwayat tanpa catatan penutup tidak bisa dipertanggungjawabkan). */
export async function verifyClose(findingId: string, note: string, userId: string): Promise<void> {
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    await transition(tx, findingId, "selesai", userId, note, "finding.verify_close", ip, {
      closedById: userId,
      closedAt: new Date(),
    });
  });
}

/** Verifikator MENOLAK pengajuan → kembali ditindaklanjuti, alasan wajib. */
export async function rejectVerification(findingId: string, reason: string, userId: string): Promise<void> {
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    const finding = await tx.finding.findUnique({ where: { id: findingId }, select: { status: true } });
    if (!finding) throw new FindingError("Temuan tidak ditemukan.");
    if (finding.status !== "menunggu_verifikasi") {
      throw new FindingError("Hanya temuan yang menunggu verifikasi yang bisa ditolak.");
    }
    await transition(tx, findingId, "ditindaklanjuti", userId, reason, "finding.reject", ip);
  });
}

/** Verifikator MEMBUKA KEMBALI temuan selesai — alasan wajib, reopenCount naik. */
export async function reopenFinding(findingId: string, reason: string, userId: string): Promise<void> {
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    await transition(tx, findingId, "dibuka_kembali", userId, reason, "finding.reopen", ip, {
      reopenCount: { increment: 1 },
      closedById: null,
      closedAt: null,
    });
  });
}

/* ── Bukti (EvidenceLink) ────────────────────────────────────────────────── */

export type LinkEvidenceInput = {
  findingId?: string | null;
  inspectionId?: string | null;
  clarificationId?: string | null;
  photoId?: string | null;
  documentId?: string | null;
  caption?: string | null;
};

/**
 * Tautkan bukti. Validasi lingkup di sini (bukan cuma CHECK DB):
 * foto harus milik LOKASI yang sama dengan induknya; dokumen harus milik
 * ORGANISASI yang sama. Tanpa ini, bukti lokasi lain bisa "membuktikan"
 * temuan yang tidak ada hubungannya.
 */
export async function linkEvidence(input: LinkEvidenceInput, userId: string): Promise<{ id: string }> {
  const sumber = [input.photoId, input.documentId].filter(Boolean);
  if (sumber.length !== 1) throw new FindingError("Bukti harus tepat satu: foto ATAU dokumen.");
  const induk = [input.findingId, input.inspectionId, input.clarificationId].filter(Boolean);
  if (induk.length === 0) throw new FindingError("Bukti harus menempel ke temuan, inspeksi, atau klarifikasi.");

  // Lokasi induk (untuk cek lingkup).
  let locationId: string | null = null;
  if (input.findingId) {
    const f = await db.finding.findUnique({ where: { id: input.findingId }, select: { locationId: true } });
    if (!f) throw new FindingError("Temuan tidak ditemukan.");
    locationId = f.locationId;
  } else if (input.inspectionId) {
    const i = await db.inspection.findUnique({ where: { id: input.inspectionId }, select: { locationId: true } });
    if (!i) throw new FindingError("Inspeksi tidak ditemukan.");
    locationId = i.locationId;
  } else if (input.clarificationId) {
    const c = await db.findingClarification.findUnique({
      where: { id: input.clarificationId },
      select: { finding: { select: { locationId: true } } },
    });
    if (!c) throw new FindingError("Klarifikasi tidak ditemukan.");
    locationId = c.finding.locationId;
  }
  if (!locationId) throw new FindingError("Induk bukti tidak punya lokasi.");

  if (input.photoId) {
    const photo = await db.photo.findUnique({ where: { id: input.photoId }, select: { locationId: true } });
    if (!photo) throw new FindingError("Foto tidak ditemukan.");
    if (photo.locationId !== locationId) throw new FindingError("Foto itu milik lokasi lain.");
  }
  if (input.documentId) {
    const [doc, loc] = await Promise.all([
      db.document.findUnique({ where: { id: input.documentId }, select: { orgId: true, status: true } }),
      db.location.findUnique({ where: { id: locationId }, select: { package: { select: { orgId: true } } } }),
    ]);
    if (!doc) throw new FindingError("Dokumen tidak ditemukan.");
    if (doc.status !== "aktif") throw new FindingError("Dokumen yang dibatalkan tidak bisa jadi bukti.");
    if (doc.orgId !== loc?.package.orgId) throw new FindingError("Dokumen itu milik organisasi lain.");
  }

  const ip = await requestIp();
  return db.$transaction(async (tx) => {
    const link = await tx.evidenceLink.create({
      data: {
        findingId: input.findingId ?? null,
        inspectionId: input.inspectionId ?? null,
        clarificationId: input.clarificationId ?? null,
        photoId: input.photoId ?? null,
        documentId: input.documentId ?? null,
        caption: input.caption ?? null,
        addedById: userId,
      },
      select: { id: true },
    });
    await auditIn(tx, userId, "evidence.link", "evidence_link", link.id, {
      findingId: input.findingId,
      inspectionId: input.inspectionId,
      clarificationId: input.clarificationId,
      photoId: input.photoId,
      documentId: input.documentId,
    }, ip);
    return link;
  });
}

/** Verifikator menilai satu bukti (diterima/ditolak) — per tautan. */
export async function verifyEvidence(
  linkId: string,
  status: Exclude<EvidenceVerifStatus, "belum">,
  note: string | null,
  userId: string,
): Promise<void> {
  const ip = await requestIp();
  await db.$transaction(async (tx) => {
    const link = await tx.evidenceLink.findUnique({ where: { id: linkId }, select: { id: true } });
    if (!link) throw new FindingError("Tautan bukti tidak ditemukan.");
    await tx.evidenceLink.update({
      where: { id: linkId },
      data: { verifStatus: status, verifiedById: userId, verifiedAt: new Date(), verifNote: note },
    });
    await auditIn(tx, userId, "evidence.verify", "evidence_link", linkId, { status, note }, ip);
  });
}

/** Lokasi sebuah temuan (untuk guard akses di actions). */
export async function findingLocationId(findingId: string): Promise<string> {
  const f = await db.finding.findUnique({ where: { id: findingId }, select: { locationId: true } });
  if (!f) throw new FindingError("Temuan tidak ditemukan.");
  return f.locationId;
}
