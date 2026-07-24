import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  hasLocationAccess,
  requireCapability,
  requireLocationAccess,
  type SessionUser,
} from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { isR2Configured, r2Put } from "@/lib/r2";
import { jakartaDateKey } from "@/lib/format";
import { ADMIN_MILESTONE_TEMPLATE } from "@/lib/milestones/template";
import type { AdminPhase, DocumentType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Document Center — upload, supersede (arsip, TANPA delete), listing.
 * Kebijakan:
 * - File di R2, metadata di Postgres. Dokumen tidak pernah dihapus;
 *   versi baru memakai supersedesId (jejak arsip utuh).
 * - Dedup per organisasi via sha256 — file identik ditolak dengan judul dokumen existing.
 * - Upload otomatis menautkan milestone administrasi (docTypes template):
 *   milestone tanpa verifikasi → selesai; dengan verifikasi → berjalan (manusia tetap wajib verifikasi).
 */

// Konstanta label/fase/tipe dipisah ke modul client-safe.
export {
  PHASE_ORDER,
  PHASE_LABEL,
  TYPE_LABEL,
  ALL_PHASES,
  ALL_DOC_TYPES,
  TYPES_BY_PHASE,
  MAX_UPLOAD_BYTES,
  ALLOWED_UPLOAD_MIMES,
} from "@/lib/documents-meta";
import { ALLOWED_UPLOAD_MIMES, MAX_UPLOAD_BYTES, PHASE_LABEL, TYPE_LABEL } from "@/lib/documents-meta";

/** Nama file aman untuk key R2: whitelist karakter, ekstensi dipertahankan (ambil ekor). */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "");
  return (cleaned || "berkas").slice(-80);
}

export class DocumentError extends Error {}

// ─── Upload ──────────────────────────────────────────────────────────

export type UploadDocumentInput = {
  file: File;
  packageId?: string | null;
  contractId?: string | null;
  locationId?: string | null;
  amendmentId?: string | null;
  milestoneId?: string | null;
  phase: AdminPhase;
  type: DocumentType;
  title: string;
  docNumber?: string | null;
  docDate?: Date | null;
  expiryDate?: Date | null;
  description?: string | null;
  /** Diisi oleh supersedeDocument — bukan input form. */
  supersedesId?: string | null;
};

export type UploadedDocument = { id: string; title: string; milestoneId: string | null };

export async function uploadDocument(input: UploadDocumentInput, userId: string): Promise<UploadedDocument> {
  const user = await requireCapability("document.upload");
  if (user.id !== userId) throw new DocumentError("Sesi tidak cocok dengan pengunggah");
  if (input.locationId) await requireLocationAccess(user, input.locationId);

  if (!isR2Configured()) {
    throw new DocumentError(
      "Penyimpanan file (R2) belum dikonfigurasi — upload dinonaktifkan. Hubungi admin (menu Sistem → Diagnostik R2).",
    );
  }

  const { file } = input;
  if (!(file instanceof File) || file.size === 0) throw new DocumentError("File wajib dipilih");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new DocumentError(`Ukuran file ${(file.size / 1024 / 1024).toFixed(1)} MB melebihi batas 15 MB`);
  }
  if (!ALLOWED_UPLOAD_MIMES[file.type]) {
    throw new DocumentError(
      `Jenis file tidak didukung (${file.type || "tidak dikenal"}). Yang diterima: ${Object.values(ALLOWED_UPLOAD_MIMES).join(", ")}`,
    );
  }

  // Validasi & derivasi relasi (semua wajib satu organisasi).
  let packageId = input.packageId ?? null;
  if (input.locationId) {
    const location = await db.location.findUnique({
      where: { id: input.locationId },
      select: { id: true, packageId: true, package: { select: { orgId: true } } },
    });
    if (!location || location.package.orgId !== user.orgId) throw new DocumentError("Lokasi tidak ditemukan");
    if (packageId && packageId !== location.packageId) {
      throw new DocumentError("Paket yang dipilih tidak sesuai dengan paket lokasi");
    }
    packageId = location.packageId;
  }
  if (packageId) {
    const pkg = await db.package.findUnique({ where: { id: packageId }, select: { orgId: true } });
    if (!pkg || pkg.orgId !== user.orgId) throw new DocumentError("Paket tidak ditemukan");
  }
  if (input.contractId) {
    const contract = await db.contract.findUnique({
      where: { id: input.contractId },
      select: { package: { select: { orgId: true } } },
    });
    if (!contract || contract.package.orgId !== user.orgId) throw new DocumentError("Kontrak tidak ditemukan");
  }
  if (input.amendmentId) {
    const amendment = await db.contractAmendment.findUnique({
      where: { id: input.amendmentId },
      select: { contract: { select: { package: { select: { orgId: true } } } } },
    });
    if (!amendment || amendment.contract.package.orgId !== user.orgId) {
      throw new DocumentError("Adendum tidak ditemukan");
    }
  }
  if (input.supersedesId) {
    const old = await db.document.findUnique({ where: { id: input.supersedesId }, select: { orgId: true } });
    if (!old || old.orgId !== user.orgId) throw new DocumentError("Dokumen lama tidak ditemukan");
  }

  // Milestone: eksplisit dari form, atau otomatis dari docTypes template.
  let milestone: {
    id: string;
    status: string;
    requiresVerification: boolean;
    note: string | null;
    name: string;
  } | null = null;
  if (input.milestoneId) {
    const ms = await db.adminMilestone.findUnique({
      where: { id: input.milestoneId },
      select: {
        id: true,
        status: true,
        requiresVerification: true,
        note: true,
        name: true,
        package: { select: { orgId: true } },
      },
    });
    if (!ms || ms.package.orgId !== user.orgId) throw new DocumentError("Milestone tidak ditemukan");
    milestone = ms;
  } else if (packageId) {
    // Sync otomatis berbasis scope: dokumen tipe X → milestone yang docTypes-nya
    // memuat X. Milestone INDUK (scope paket) dicari di locationId null; milestone
    // LOKASI dicari di locationId dokumen. Ini memastikan dokumen induk (jaminan,
    // SPMK, kontrak) menandai SATU milestone induk, bukan tercecer per lokasi.
    const matching = ADMIN_MILESTONE_TEMPLATE.filter((t) => t.docTypes.includes(input.type));
    const paketKeys = matching.filter((t) => t.scope === "paket").map((t) => t.key);
    const lokasiKeys = matching.filter((t) => t.scope === "lokasi").map((t) => t.key);
    const or: Prisma.AdminMilestoneWhereInput[] = [];
    if (paketKeys.length > 0) or.push({ locationId: null, templateKey: { in: paketKeys } });
    if (lokasiKeys.length > 0 && input.locationId)
      or.push({ locationId: input.locationId, templateKey: { in: lokasiKeys } });
    if (or.length > 0) {
      milestone = await db.adminMilestone.findFirst({
        where: { packageId, status: { notIn: ["selesai", "tidak_berlaku"] }, OR: or },
        orderBy: { sortOrder: "asc" },
        select: { id: true, status: true, requiresVerification: true, note: true, name: true },
      });
    }
  }

  // Dedup per organisasi (sha256 isi file).
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const duplicate = await db.document.findFirst({
    where: { orgId: user.orgId, sha256 },
    select: { title: true, uploadedAt: true },
  });
  if (duplicate) {
    throw new DocumentError(
      `File identik sudah pernah diunggah sebagai "${duplicate.title}" — tidak perlu diunggah ulang.`,
    );
  }

  const yyyy = jakartaDateKey(new Date()).slice(0, 4);
  const r2Key = `documents/${yyyy}/${randomUUID()}-${sanitizeFileName(file.name)}`;
  await r2Put(r2Key, buffer, file.type);

  const doc = await db.document.create({
    data: {
      orgId: user.orgId,
      packageId,
      contractId: input.contractId ?? null,
      locationId: input.locationId ?? null,
      amendmentId: input.amendmentId ?? null,
      milestoneId: milestone?.id ?? null,
      phase: input.phase,
      type: input.type,
      title: input.title.trim(),
      docNumber: input.docNumber?.trim() || null,
      docDate: input.docDate ?? null,
      expiryDate: input.expiryDate ?? null,
      description: input.description?.trim() || null,
      r2Key,
      fileName: file.name,
      mimeType: file.type,
      bytes: file.size,
      sha256,
      supersedesId: input.supersedesId ?? null,
      uploadedById: user.id,
    },
    select: { id: true, title: true, milestoneId: true },
  });
  await audit(user.id, "document.upload", "document", doc.id, {
    type: input.type,
    phase: input.phase,
    bytes: file.size,
    locationId: input.locationId ?? null,
    milestoneId: milestone?.id ?? null,
    supersedesId: input.supersedesId ?? null,
  });

  // Efek kepatuhan milestone.
  if (milestone && milestone.status !== "selesai" && milestone.status !== "tidak_berlaku") {
    if (!milestone.requiresVerification) {
      await db.adminMilestone.update({
        where: { id: milestone.id },
        data: {
          status: "selesai",
          completedAt: new Date(),
          note: milestone.note || `Selesai otomatis — bukti "${doc.title}" diunggah`,
        },
      });
      await audit(user.id, "milestone.auto_selesai", "admin_milestone", milestone.id, {
        documentId: doc.id,
        milestone: milestone.name,
      });
    } else if (milestone.status !== "berjalan") {
      // Dokumen kritis: bukti masuk = berjalan; verifikasi manusia tetap wajib.
      await db.adminMilestone.update({ where: { id: milestone.id }, data: { status: "berjalan" } });
      await audit(user.id, "milestone.bukti_masuk", "admin_milestone", milestone.id, {
        documentId: doc.id,
        milestone: milestone.name,
        catatan: "Menunggu verifikasi manusia",
      });
    }
  }

  return doc;
}

/**
 * Versi baru menggantikan dokumen lama (arsip — dokumen lama TIDAK dihapus).
 * Field relasi/fase/tipe default mengikuti dokumen lama bila tidak diisi.
 */
export async function supersedeDocument(
  oldDocumentId: string,
  input: Omit<UploadDocumentInput, "supersedesId">,
  userId: string,
): Promise<UploadedDocument> {
  const user = await requireCapability("document.upload");
  const old = await db.document.findUnique({
    where: { id: oldDocumentId },
    select: {
      id: true,
      orgId: true,
      packageId: true,
      contractId: true,
      locationId: true,
      amendmentId: true,
      milestoneId: true,
      phase: true,
      type: true,
      title: true,
    },
  });
  if (!old || old.orgId !== user.orgId) throw new DocumentError("Dokumen lama tidak ditemukan");
  if (old.locationId) await requireLocationAccess(user, old.locationId);
  return uploadDocument(
    {
      ...input,
      packageId: input.packageId ?? old.packageId,
      contractId: input.contractId ?? old.contractId,
      locationId: input.locationId ?? old.locationId,
      amendmentId: input.amendmentId ?? old.amendmentId,
      milestoneId: input.milestoneId ?? old.milestoneId,
      phase: input.phase ?? old.phase,
      type: input.type ?? old.type,
      title: input.title || old.title,
      supersedesId: old.id,
    },
    userId,
  );
}

// ─── Listing (grid Document Center) ──────────────────────────────────

export type DocumentListParams = {
  orgId: string;
  packageId?: string;
  locationId?: string;
  phase?: AdminPhase;
  type?: DocumentType;
  q?: string;
  /** null = semua lokasi (role cross-location). */
  scopedLocationIds: string[] | null;
};

export type DocumentRow = {
  id: string;
  title: string;
  type: DocumentType;
  phase: AdminPhase;
  docNumber: string | null;
  docDate: Date | null;
  expiryDate: Date | null;
  fileName: string;
  mimeType: string;
  bytes: number;
  packageId: string | null;
  packageName: string | null;
  locationId: string | null;
  locationName: string | null;
  milestoneId: string | null;
  supersedesId: string | null;
  uploadedById: string;
  uploadedByName: string;
  uploadedAt: Date;
};

export async function listDocuments(params: DocumentListParams): Promise<DocumentRow[]> {
  const where: Prisma.DocumentWhereInput = {
    orgId: params.orgId,
    ...(params.packageId ? { packageId: params.packageId } : {}),
    ...(params.locationId ? { locationId: params.locationId } : {}),
    ...(params.phase ? { phase: params.phase } : {}),
    ...(params.type ? { type: params.type } : {}),
    ...(params.q
      ? {
          OR: [
            { title: { contains: params.q, mode: "insensitive" } },
            { docNumber: { contains: params.q, mode: "insensitive" } },
            { fileName: { contains: params.q, mode: "insensitive" } },
            { description: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  if (params.scopedLocationIds !== null) {
    // Role ter-scope: dokumen lokasinya sendiri + dokumen level-paket dari paket
    // yang memuat lokasinya + dokumen level-organisasi.
    where.AND = [
      {
        OR: [
          { locationId: { in: params.scopedLocationIds } },
          {
            locationId: null,
            package: { locations: { some: { id: { in: params.scopedLocationIds } } } },
          },
          { locationId: null, packageId: null },
        ],
      },
    ];
  }

  const docs = await db.document.findMany({
    where,
    orderBy: { uploadedAt: "desc" },
    take: 1000,
    select: {
      id: true,
      title: true,
      type: true,
      phase: true,
      docNumber: true,
      docDate: true,
      expiryDate: true,
      fileName: true,
      mimeType: true,
      bytes: true,
      packageId: true,
      locationId: true,
      milestoneId: true,
      supersedesId: true,
      uploadedById: true,
      uploadedAt: true,
      package: { select: { name: true } },
      location: { select: { name: true } },
    },
  });

  // Document tidak punya relasi User — join manual pengunggah.
  const uploaderIds = [...new Set(docs.map((d) => d.uploadedById))];
  const uploaders = uploaderIds.length
    ? await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(uploaders.map((u) => [u.id, u.fullName]));

  return docs.map((d) => ({
    id: d.id,
    title: d.title,
    type: d.type,
    phase: d.phase,
    docNumber: d.docNumber,
    docDate: d.docDate,
    expiryDate: d.expiryDate,
    fileName: d.fileName,
    mimeType: d.mimeType,
    bytes: d.bytes,
    packageId: d.packageId,
    packageName: d.package?.name ?? null,
    locationId: d.locationId,
    locationName: d.location?.name ?? null,
    milestoneId: d.milestoneId,
    supersedesId: d.supersedesId,
    uploadedById: d.uploadedById,
    uploadedByName: nameById.get(d.uploadedById) ?? "—",
    uploadedAt: d.uploadedAt,
  }));
}

/** Dokumen boleh dilihat user ini? Dipakai route unduh. */
export async function canViewDocument(
  user: SessionUser,
  doc: { orgId: string; locationId: string | null },
): Promise<boolean> {
  if (doc.orgId !== user.orgId) return false;
  if (doc.locationId) return hasLocationAccess(user, doc.locationId);
  return can(user.role, "document.view");
}
