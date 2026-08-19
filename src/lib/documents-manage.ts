import "server-only";
import { db } from "@/lib/db";
import { auditIn } from "@/lib/audit";
import { requestIp, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { r2Delete } from "@/lib/r2";
import { DocumentError } from "@/lib/documents";
import type { AdminPhase, DocumentType } from "@/generated/prisma/enums";

/**
 * Siklus hidup dokumen: KOREKSI metadata, BATALKAN, PULIHKAN, HAPUS PERMANEN.
 *
 * Kebijakan (DECISIONS 183):
 * - Salah unggah wajib bisa dibereskan. Yang bisa dikoreksi cuma metadata
 *   (jenis/fase/nomor/tanggal/tautan) — isi berkas TIDAK pernah ditukar diam-diam;
 *   berkas keliru dibatalkan lalu diunggah ulang (jejak `supersedesId` sudah ada).
 * - BATALKAN = reversibel: dokumen hilang dari daftar & tidak lagi dihitung sebagai
 *   bukti milestone, tetapi file di R2 + baris DB + audit tetap utuh.
 * - HAPUS PERMANEN = super_admin saja, hanya atas dokumen yang sudah dibatalkan,
 *   dan ditolak bila dokumen masih dipakai sebagai sumber RAB / bukti pengeluaran /
 *   induk versi. Ini satu-satunya jalan file benar-benar lenyap dari R2.
 * - Setiap mutasi memakai `auditIn` di dalam transaksi yang sama: perubahan status
 *   dokumen & jejaknya sehidup-semati (AUDIT-01).
 */

export type DocumentMetaPatch = {
  title?: string;
  phase?: AdminPhase;
  type?: DocumentType;
  docNumber?: string | null;
  docDate?: Date | null;
  expiryDate?: Date | null;
  description?: string | null;
};

const EDITABLE_FIELDS = [
  "title",
  "phase",
  "type",
  "docNumber",
  "docDate",
  "expiryDate",
  "description",
] as const;

/** Nilai untuk payload audit: Date → yyyy-mm-dd, sisanya apa adanya. */
function auditValue(v: unknown): unknown {
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
}

async function loadDocument(id: string, orgId: string) {
  const doc = await db.document.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      locationId: true,
      packageId: true,
      milestoneId: true,
      status: true,
      title: true,
      phase: true,
      type: true,
      docNumber: true,
      docDate: true,
      expiryDate: true,
      description: true,
      r2Key: true,
      source: true,
    },
  });
  if (!doc || doc.orgId !== orgId) throw new DocumentError("Dokumen tidak ditemukan");
  return doc;
}

// ─── Koreksi metadata ────────────────────────────────────────────────

export async function updateDocumentMeta(
  documentId: string,
  patch: DocumentMetaPatch,
): Promise<{ changed: string[] }> {
  const user = await requireCapability("document.edit");
  const doc = await loadDocument(documentId, user.orgId);
  if (doc.locationId) await requireLocationAccess(user, doc.locationId);
  if (doc.status === "dibatalkan") {
    throw new DocumentError("Dokumen sudah dibatalkan – pulihkan dulu sebelum dikoreksi.");
  }

  // Kombinasi fase × jenis TIDAK dibatasi di sini: jalur upload pun tidak
  // membatasinya, jadi memvalidasi saat koreksi justru mengunci dokumen lama
  // pada kombinasi keliru yang mau dibetulkan.

  // Hanya kirim field yang benar-benar berubah supaya payload audit jujur.
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (!(key in patch)) continue;
    const next = patch[key] ?? null;
    const prev = doc[key] ?? null;
    const same =
      prev instanceof Date && next instanceof Date
        ? prev.getTime() === next.getTime()
        : prev === next;
    if (same) continue;
    data[key] = next;
    before[key] = auditValue(prev);
    after[key] = auditValue(next);
  }
  const changed = Object.keys(data);
  if (changed.length === 0) return { changed };

  const ip = (await requestIp()) ?? null;
  await db.$transaction(async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data });
    await auditIn(tx, user.id, "document.edit", "document", doc.id, { before, after }, ip);
  });
  return { changed };
}

// ─── Batalkan / pulihkan ─────────────────────────────────────────────

/**
 * Milestone yang menandai selesai/berjalan KARENA dokumen ini harus ikut turun
 * saat buktinya dibatalkan — kalau tidak, kepatuhan administrasi berbohong.
 *
 * Pengecualian: milestone yang sudah DIVERIFIKASI MANUSIA (`verifiedById`) tidak
 * diturunkan otomatis — keputusan orang tidak boleh dibatalkan oleh efek samping.
 * Kasus itu dicatat di audit + catatan milestone supaya kelihatan perlu ditinjau.
 */
async function syncMilestoneAfterVoid(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  doc: { id: string; milestoneId: string | null; title: string },
  userId: string,
  ip: string | null,
): Promise<void> {
  if (!doc.milestoneId) return;
  const ms = await tx.adminMilestone.findUnique({
    where: { id: doc.milestoneId },
    select: { id: true, name: true, status: true, verifiedById: true, note: true },
  });
  if (!ms) return;

  const buktiLain = await tx.document.count({
    where: { milestoneId: ms.id, status: "aktif", id: { not: doc.id } },
  });
  if (buktiLain > 0) return;
  if (ms.status !== "selesai" && ms.status !== "berjalan") return;

  if (ms.verifiedById) {
    await tx.adminMilestone.update({
      where: { id: ms.id },
      data: {
        note: `${ms.note ? `${ms.note}\n` : ""}Perlu ditinjau: bukti "${doc.title}" dibatalkan, status dipertahankan karena sudah diverifikasi manusia.`,
      },
    });
    await auditIn(
      tx,
      userId,
      "milestone.bukti_dibatalkan",
      "admin_milestone",
      ms.id,
      { documentId: doc.id, milestone: ms.name, statusDipertahankan: ms.status },
      ip,
    );
    return;
  }

  await tx.adminMilestone.update({
    where: { id: ms.id },
    data: {
      status: "belum_dimulai",
      completedAt: null,
      note: `${ms.note ? `${ms.note}\n` : ""}Dikembalikan otomatis – bukti "${doc.title}" dibatalkan.`,
    },
  });
  await auditIn(
    tx,
    userId,
    "milestone.dikembalikan",
    "admin_milestone",
    ms.id,
    { documentId: doc.id, milestone: ms.name, statusSebelum: ms.status },
    ip,
  );
}

export async function voidDocument(documentId: string, reason: string): Promise<{ title: string }> {
  const user = await requireCapability("document.void");
  const doc = await loadDocument(documentId, user.orgId);
  if (doc.locationId) await requireLocationAccess(user, doc.locationId);
  if (doc.status === "dibatalkan") throw new DocumentError("Dokumen ini sudah dibatalkan.");

  const alasan = reason.trim();
  if (alasan.length < 5) throw new DocumentError("Alasan pembatalan wajib diisi (minimal 5 karakter).");

  // Dokumen yang dipakai sebagai sumber angka tidak boleh hilang dari daftar
  // tanpa peringatan — RAB & pengeluaran menunjuk ke dokumen ini sebagai bukti.
  const [rabRefs, expenseRefs, newerVersions] = await Promise.all([
    db.rabRevision.count({ where: { sourceDocumentId: doc.id } }),
    db.expense.count({ where: { evidenceDocumentId: doc.id } }),
    db.document.count({ where: { supersedesId: doc.id, status: "aktif" } }),
  ]);
  if (rabRefs > 0) {
    throw new DocumentError(
      "Dokumen ini sumber RAB yang sudah diimpor – batalkan/ganti revisi RAB-nya dulu, jangan buang buktinya.",
    );
  }
  if (expenseRefs > 0) {
    throw new DocumentError(
      `Dokumen ini bukti ${expenseRefs} transaksi pengeluaran – lepaskan bukti dari transaksinya dulu.`,
    );
  }

  const ip = (await requestIp()) ?? null;
  await db.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: doc.id },
      data: {
        status: "dibatalkan",
        voidedAt: new Date(),
        voidedById: user.id,
        voidReason: alasan,
      },
    });
    await auditIn(
      tx,
      user.id,
      "document.void",
      "document",
      doc.id,
      {
        alasan,
        type: doc.type,
        phase: doc.phase,
        locationId: doc.locationId,
        milestoneId: doc.milestoneId,
        adaVersiPenerus: newerVersions > 0,
      },
      ip,
    );
    await syncMilestoneAfterVoid(tx, { id: doc.id, milestoneId: doc.milestoneId, title: doc.title }, user.id, ip);
  });
  return { title: doc.title };
}

export async function restoreDocument(documentId: string): Promise<{ title: string }> {
  const user = await requireCapability("document.void");
  const doc = await loadDocument(documentId, user.orgId);
  if (doc.locationId) await requireLocationAccess(user, doc.locationId);
  if (doc.status !== "dibatalkan") throw new DocumentError("Dokumen ini tidak dalam status dibatalkan.");

  const ip = (await requestIp()) ?? null;
  await db.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: doc.id },
      data: { status: "aktif", voidedAt: null, voidedById: null, voidReason: null },
    });
    await auditIn(tx, user.id, "document.restore", "document", doc.id, { type: doc.type }, ip);
  });
  // Efek milestone TIDAK dihidupkan ulang otomatis: penilaian kepatuhan biar
  // dilakukan sadar oleh manusia lewat halaman Administrasi.
  return { title: doc.title };
}

// ─── Hapus permanen ──────────────────────────────────────────────────

/**
 * Hapus permanen: baris DB + file R2. Urutannya DB dulu lalu R2 — bila hapus R2
 * gagal, yang tertinggal cuma file tanpa acuan (sampah penyimpanan yang bisa
 * disapu ulang), bukan baris dokumen yang menunjuk file hilang.
 */
export async function deleteDocumentPermanently(
  documentId: string,
): Promise<{ title: string; storageWarning: string | null }> {
  const user = await requireCapability("document.delete");
  const doc = await loadDocument(documentId, user.orgId);
  if (doc.status !== "dibatalkan") {
    throw new DocumentError("Batalkan dokumen dulu – hapus permanen hanya untuk dokumen yang sudah dibatalkan.");
  }

  const [rabRefs, expenseRefs, versionRefs] = await Promise.all([
    db.rabRevision.count({ where: { sourceDocumentId: doc.id } }),
    db.expense.count({ where: { evidenceDocumentId: doc.id } }),
    db.document.count({ where: { supersedesId: doc.id } }),
  ]);
  if (rabRefs > 0 || expenseRefs > 0 || versionRefs > 0) {
    const sebab = [
      rabRefs > 0 ? `${rabRefs} revisi RAB` : null,
      expenseRefs > 0 ? `${expenseRefs} transaksi pengeluaran` : null,
      versionRefs > 0 ? `${versionRefs} dokumen versi penerus` : null,
    ].filter(Boolean);
    throw new DocumentError(
      `Tidak bisa dihapus permanen – masih diacu oleh ${sebab.join(" dan ")}. Dokumen tetap dibatalkan (tidak muncul di daftar).`,
    );
  }

  const ip = (await requestIp()) ?? null;
  await db.$transaction(async (tx) => {
    await auditIn(
      tx,
      user.id,
      "document.delete",
      "document",
      doc.id,
      {
        title: doc.title,
        type: doc.type,
        phase: doc.phase,
        locationId: doc.locationId,
        packageId: doc.packageId,
        r2Key: doc.r2Key,
        source: doc.source,
        catatan: "Hapus permanen – baris & file tidak bisa dipulihkan",
      },
      ip,
    );
    await tx.document.delete({ where: { id: doc.id } });
  });

  let storageWarning: string | null = null;
  try {
    await r2Delete(doc.r2Key);
  } catch (err) {
    storageWarning = `Baris dokumen terhapus, tetapi file di penyimpanan gagal dihapus (${
      err instanceof Error ? err.message : "sebab tidak diketahui"
    }). File sudah tidak bisa diakses dari MARLIN.`;
  }
  return { title: doc.title, storageWarning };
}
