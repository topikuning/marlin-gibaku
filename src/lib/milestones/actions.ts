"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  ForbiddenError,
  requireCapability,
  requireLocationAccess,
  requireUser,
} from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { parseDateKey } from "@/lib/format";
import { ADMIN_MILESTONE_TEMPLATE, LOKASI_MILESTONES, PAKET_MILESTONES, milestoneTemplate } from "@/lib/milestones/template";
import { statusAfterUpload } from "@/lib/milestones/status";
import { uploadDocument } from "@/lib/documents";
import type { AdminPhase, DocumentType, MilestoneStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Aksi kepatuhan milestone administrasi.
 * - ensureMilestones: materialisasi template 45 item, idempotent.
 * - updateMilestone: compliance.manage; "selesai" pada milestone requiresVerification
 *   butuh document.verify (verifiedById terisi).
 * - verifyMilestone: document.verify — tombol "Verifikasi & Selesai".
 */

const MILESTONE_STATUSES = [
  "belum_dimulai",
  "berjalan",
  "menunggu_pihak_lain",
  "perlu_perbaikan",
  "selesai",
  "tidak_berlaku",
] as const satisfies readonly MilestoneStatus[];

/**
 * Pastikan milestone template ada untuk paket (+lokasi). Idempotent:
 * hanya membuat templateKey yang belum ada, tidak menyentuh status existing.
 */
export async function ensureMilestones(packageId: string, locationId?: string): Promise<void> {
  const user = await requireUser();
  const pkg = await db.package.findUnique({ where: { id: packageId }, select: { orgId: true } });
  if (!pkg || pkg.orgId !== user.orgId) throw new ForbiddenError("Paket tidak ditemukan");
  if (locationId) {
    const location = await db.location.findUnique({ where: { id: locationId }, select: { packageId: true } });
    if (!location || location.packageId !== packageId) throw new ForbiddenError("Lokasi tidak sesuai paket");
    await requireLocationAccess(user, locationId);
  }

  // Milestone INDUK (scope "paket") dimaterialisasi SEKALI (locationId null);
  // milestone LOKASI (scope "lokasi") per Location. Ini mencegah dokumen induk
  // (SPPBJ, kontrak, jaminan, SPMK, PCM, termin, PHO/FHO) tercecer jadi salinan
  // per-lokasi yang tak sinkron. DECISIONS 078.
  const materialize = async (scoped: typeof ADMIN_MILESTONE_TEMPLATE, locId: string | null) => {
    const existing = await db.adminMilestone.findMany({
      where: { packageId, locationId: locId },
      select: { templateKey: true },
    });
    const have = new Set(existing.map((m) => m.templateKey));
    const missing = scoped.filter((t) => !have.has(t.key));
    if (missing.length === 0) return 0;
    await db.adminMilestone.createMany({
      data: missing.map((t) => ({
        packageId,
        locationId: locId,
        templateKey: t.key,
        name: t.name,
        phase: t.phase,
        sortOrder: t.sortOrder,
        requiresVerification: t.requiresVerification,
      })),
    });
    return missing.length;
  };

  let created = 0;
  created += await materialize(PAKET_MILESTONES, null);
  if (locationId) created += await materialize(LOKASI_MILESTONES, locationId);

  // Self-heal warisan (sebelum DECISIONS 078): milestone scope-paket yang telanjur
  // dibuat per-lokasi → gabung ke induk (pindahkan dokumen, ambil status paling
  // maju, hapus salinan lokasi). Idempoten; setelah bersih, query balik kosong.
  const consolidated = await consolidateLegacyPaketMilestones(packageId);

  if (created === 0 && consolidated === 0) return;

  await audit(user.id, "milestone.ensure", "package", packageId, {
    locationId: locationId ?? null,
    created,
    consolidated,
  });
}

/** Seberapa "maju" sebuah status (untuk memilih yang paling maju saat merge). */
const STATUS_RANK: Record<MilestoneStatus, number> = {
  belum_dimulai: 0,
  tidak_berlaku: 1,
  menunggu_pihak_lain: 2,
  perlu_perbaikan: 2,
  berjalan: 3,
  selesai: 4,
};

/**
 * Gabungkan milestone scope-paket yang telanjur dibuat per-lokasi ke satu induk
 * (locationId null). Pindahkan dokumen, ambil status/verifikasi/PIC/dsb paling
 * maju, lalu hapus salinan lokasi. Return jumlah salinan yang dibersihkan.
 */
async function consolidateLegacyPaketMilestones(packageId: string): Promise<number> {
  const paketKeys = PAKET_MILESTONES.map((t) => t.key);
  const legacy = await db.adminMilestone.findMany({
    where: { packageId, locationId: { not: null }, templateKey: { in: paketKeys } },
    select: {
      id: true,
      templateKey: true,
      status: true,
      completedAt: true,
      verifiedById: true,
      picUserId: true,
      dueDate: true,
      note: true,
    },
  });
  if (legacy.length === 0) return 0;

  const induk = await db.adminMilestone.findMany({
    where: { packageId, locationId: null, templateKey: { in: paketKeys } },
    select: {
      id: true,
      templateKey: true,
      status: true,
      completedAt: true,
      verifiedById: true,
      picUserId: true,
      dueDate: true,
      note: true,
    },
  });
  const indukByKey = new Map(induk.map((m) => [m.templateKey, m]));

  const byKey = new Map<string, typeof legacy>();
  for (const m of legacy) {
    const arr = byKey.get(m.templateKey) ?? [];
    arr.push(m);
    byKey.set(m.templateKey, arr);
  }

  let cleaned = 0;
  for (const [key, copies] of byKey) {
    const target = indukByKey.get(key);
    if (!target) continue; // induk selalu ada (baru dimaterialisasi)
    const legacyIds = copies.map((c) => c.id);

    // Pilih sumber "paling maju" (termasuk induk) untuk status & metadata.
    const best = [target, ...copies].reduce((a, b) =>
      STATUS_RANK[b.status] > STATUS_RANK[a.status] ? b : a,
    );

    await db.$transaction([
      // Dokumen yang tertaut ke salinan lokasi → pindah ke induk.
      db.document.updateMany({
        where: { milestoneId: { in: legacyIds } },
        data: { milestoneId: target.id },
      }),
      // Induk mewarisi status/verifikasi/PIC/catatan paling maju (bila lebih maju).
      db.adminMilestone.update({
        where: { id: target.id },
        data: {
          status: best.status,
          completedAt: best.completedAt,
          verifiedById: best.verifiedById,
          picUserId: target.picUserId ?? best.picUserId,
          dueDate: target.dueDate ?? best.dueDate,
          note: target.note ?? best.note,
        },
      }),
      db.adminMilestone.deleteMany({ where: { id: { in: legacyIds } } }),
    ]);
    cleaned += legacyIds.length;
  }
  return cleaned;
}

export type MilestoneUpdateInput = {
  status?: MilestoneStatus;
  picUserId?: string | null;
  dueDate?: Date | null;
  note?: string | null;
};

async function loadScopedMilestone(id: string, user: { orgId: string }) {
  const ms = await db.adminMilestone.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      requiresVerification: true,
      locationId: true,
      packageId: true,
      phase: true,
      templateKey: true,
      name: true,
      package: { select: { orgId: true } },
    },
  });
  if (!ms || ms.package.orgId !== user.orgId) throw new ForbiddenError("Milestone tidak ditemukan");
  return ms;
}

export async function updateMilestone(id: string, input: MilestoneUpdateInput, userId: string): Promise<void> {
  const user = await requireCapability("compliance.manage");
  if (user.id !== userId) throw new ForbiddenError("Sesi tidak cocok");
  const ms = await loadScopedMilestone(id, user);
  if (ms.locationId) await requireLocationAccess(user, ms.locationId);

  const data: Prisma.AdminMilestoneUpdateInput = {};
  if (input.status !== undefined && input.status !== ms.status) {
    if (input.status === "selesai" && ms.requiresVerification) {
      if (!can(user.role, "document.verify")) {
        throw new ForbiddenError(
          "Milestone ini butuh verifikasi dokumen — hanya pemegang izin verifikasi yang boleh menandai selesai",
        );
      }
      data.verifiedById = user.id;
    }
    data.status = input.status;
    data.completedAt = input.status === "selesai" ? new Date() : null;
    if (input.status !== "selesai") data.verifiedById = null;
  }
  if (input.picUserId !== undefined) data.picUserId = input.picUserId;
  if (input.dueDate !== undefined) data.dueDate = input.dueDate;
  if (input.note !== undefined) data.note = input.note?.trim() || null;

  if (Object.keys(data).length === 0) return;
  await db.adminMilestone.update({ where: { id }, data });
  await audit(user.id, "milestone.update", "admin_milestone", id, {
    milestone: ms.name,
    ...(input.status !== undefined ? { dariStatus: ms.status, keStatus: input.status } : {}),
    ...(input.picUserId !== undefined ? { picUserId: input.picUserId } : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate?.toISOString() ?? null } : {}),
  });
}

/** Verifikasi manusia untuk milestone kritis → selesai + verifiedById. */
export async function verifyMilestone(id: string, userId: string): Promise<void> {
  const user = await requireCapability("document.verify");
  if (user.id !== userId) throw new ForbiddenError("Sesi tidak cocok");
  const ms = await loadScopedMilestone(id, user);
  if (ms.locationId) await requireLocationAccess(user, ms.locationId);
  if (ms.status === "selesai") return;
  await db.adminMilestone.update({
    where: { id },
    data: { status: "selesai", completedAt: new Date(), verifiedById: user.id },
  });
  await audit(user.id, "milestone.verify", "admin_milestone", id, {
    milestone: ms.name,
    dariStatus: ms.status,
  });
}

// ─── Server actions untuk form (FormData + zod + useActionState) ────

export type MilestoneActionState = { error?: string; success?: string } | undefined;

const updateSchema = z.object({
  milestoneId: z.uuid(),
  status: z.enum(MILESTONE_STATUSES),
  picUserId: z.union([z.uuid(), z.literal("")]),
  dueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid"), z.literal("")]),
  note: z.string().max(500, "Catatan maksimal 500 karakter"),
  // Salah satu untuk revalidasi: slug (papan lokasi) atau packageId (papan induk).
  slug: z.string().optional().default(""),
  packageId: z.union([z.uuid(), z.literal("")]).optional().default(""),
});

export async function updateMilestoneAction(
  _prev: MilestoneActionState,
  formData: FormData,
): Promise<MilestoneActionState> {
  const parsed = updateSchema.safeParse({
    milestoneId: formData.get("milestoneId"),
    status: formData.get("status"),
    picUserId: formData.get("picUserId") ?? "",
    dueDate: formData.get("dueDate") ?? "",
    note: formData.get("note") ?? "",
    slug: formData.get("slug") ?? "",
    packageId: formData.get("packageId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  try {
    const user = await requireCapability("compliance.manage");
    const ms = await loadScopedMilestone(d.milestoneId, user);
    if (ms.locationId) await requireLocationAccess(user, ms.locationId);

    // Upload dokumen INLINE (bila dilampirkan): fase & tipe bukti otomatis dari
    // template milestone, judul = nama item, tertaut ke milestone ini.
    let status: MilestoneStatus = d.status;
    if (hasFile) {
      if (!can(user.role, "document.upload")) return { error: "Tidak punya izin mengunggah dokumen" };
      const type = (milestoneTemplate(ms.templateKey)?.docTypes[0] ?? "lainnya") as DocumentType;
      await uploadDocument(
        {
          file,
          packageId: ms.packageId,
          locationId: ms.locationId ?? undefined,
          milestoneId: ms.id,
          phase: ms.phase as AdminPhase,
          type,
          title: ms.name,
          docNumber: null,
          docDate: null,
          expiryDate: null,
          description: null,
        },
        user.id,
      );
      status = statusAfterUpload(ms.status, d.status, ms.requiresVerification);
    }

    await updateMilestone(
      d.milestoneId,
      {
        status,
        picUserId: d.picUserId || null,
        dueDate: d.dueDate ? parseDateKey(d.dueDate) : null,
        note: d.note,
      },
      user.id,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Gagal memperbarui milestone" };
  }
  if (d.slug) revalidatePath(`/lokasi/${d.slug}/dokumen`);
  if (d.packageId) revalidatePath(`/paket/${d.packageId}/dokumen`);
  return { success: hasFile ? "Dokumen terunggah & item diperbarui." : "Item diperbarui." };
}

// ─── Sinkronisasi kepatuhan dari dokumen ─────────────────────────────

/**
 * Tautkan dokumen paket yang BELUM terhubung milestone (mis. diunggah sebelum
 * milestone dimaterialisasi, atau lewat Document Center tanpa auto-link) ke
 * checklist kepatuhan berdasarkan jenis dokumen — lalu majukan status milestone
 * persis seperti saat upload biasa. Idempoten: dokumen yang sudah tertaut
 * diabaikan, jadi aman ditekan berulang. Return jumlah yang ditaut & dimajukan.
 */
async function syncComplianceFromDocuments(packageId: string): Promise<{ linked: number; advanced: number }> {
  const user = await requireCapability("compliance.manage");
  const pkg = await db.package.findUnique({ where: { id: packageId }, select: { orgId: true } });
  if (!pkg || pkg.orgId !== user.orgId) throw new ForbiddenError("Paket tidak ditemukan");

  // Pastikan template milestone (induk + lokasi) sudah ada sebelum menaut.
  await ensureMilestones(packageId);

  const orphans = await db.document.findMany({
    where: { packageId, milestoneId: null, status: "aktif" },
    orderBy: { uploadedAt: "asc" },
    select: { id: true, type: true, locationId: true, title: true },
  });
  if (orphans.length === 0) return { linked: 0, advanced: 0 };

  let linked = 0;
  let advanced = 0;
  for (const doc of orphans) {
    const matching = ADMIN_MILESTONE_TEMPLATE.filter((t) => t.docTypes.includes(doc.type));
    if (matching.length === 0) continue;
    const paketKeys = matching.filter((t) => t.scope === "paket").map((t) => t.key);
    const lokasiKeys = matching.filter((t) => t.scope === "lokasi").map((t) => t.key);
    const or: Prisma.AdminMilestoneWhereInput[] = [];
    if (paketKeys.length > 0) or.push({ locationId: null, templateKey: { in: paketKeys } });
    if (lokasiKeys.length > 0 && doc.locationId)
      or.push({ locationId: doc.locationId, templateKey: { in: lokasiKeys } });
    if (or.length === 0) continue;

    const select = {
      id: true,
      status: true,
      requiresVerification: true,
      note: true,
      name: true,
    } satisfies Prisma.AdminMilestoneSelect;
    // Prioritaskan milestone yang masih bisa maju; kalau semua sudah selesai,
    // tetap tautkan ke yang ada supaya dokumen muncul di checklist.
    const milestone =
      (await db.adminMilestone.findFirst({
        where: { packageId, status: { notIn: ["selesai", "tidak_berlaku"] }, OR: or },
        orderBy: { sortOrder: "asc" },
        select,
      })) ??
      (await db.adminMilestone.findFirst({
        where: { packageId, OR: or },
        orderBy: { sortOrder: "asc" },
        select,
      }));
    if (!milestone) continue;

    await db.document.update({ where: { id: doc.id }, data: { milestoneId: milestone.id } });
    linked += 1;

    // Efek kepatuhan — sama persis dengan uploadDocument.
    if (milestone.status !== "selesai" && milestone.status !== "tidak_berlaku") {
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
          catatan: "Sinkronisasi kepatuhan dari dokumen",
        });
        advanced += 1;
      } else if (milestone.status !== "berjalan") {
        await db.adminMilestone.update({ where: { id: milestone.id }, data: { status: "berjalan" } });
        await audit(user.id, "milestone.bukti_masuk", "admin_milestone", milestone.id, {
          documentId: doc.id,
          milestone: milestone.name,
          catatan: "Sinkronisasi kepatuhan — menunggu verifikasi manusia",
        });
        advanced += 1;
      }
    }
  }

  await audit(user.id, "milestone.sync_dokumen", "package", packageId, { linked, advanced });
  return { linked, advanced };
}

export type ComplianceSyncState = { error?: string; success?: string } | undefined;

export async function syncComplianceAction(
  _prev: ComplianceSyncState,
  formData: FormData,
): Promise<ComplianceSyncState> {
  const packageId = formData.get("packageId");
  if (typeof packageId !== "string" || !packageId) return { error: "Paket tidak valid" };
  try {
    const { linked, advanced } = await syncComplianceFromDocuments(packageId);
    revalidatePath(`/paket/${packageId}/dokumen`);
    if (linked === 0) return { success: "Semua dokumen sudah tersambung — tidak ada perubahan." };
    return {
      success:
        `${linked} dokumen tersambung ke checklist` +
        (advanced > 0 ? `, ${advanced} item kepatuhan maju.` : "."),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Gagal menyinkronkan kepatuhan" };
  }
}

const verifySchema = z.object({
  milestoneId: z.uuid(),
  slug: z.string().optional().default(""),
  packageId: z.union([z.uuid(), z.literal("")]).optional().default(""),
});

export async function verifyMilestoneAction(
  _prev: MilestoneActionState,
  formData: FormData,
): Promise<MilestoneActionState> {
  const parsed = verifySchema.safeParse({
    milestoneId: formData.get("milestoneId"),
    slug: formData.get("slug") ?? "",
    packageId: formData.get("packageId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await requireCapability("document.verify");
    await verifyMilestone(parsed.data.milestoneId, user.id);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Gagal memverifikasi milestone" };
  }
  if (parsed.data.slug) revalidatePath(`/lokasi/${parsed.data.slug}/dokumen`);
  if (parsed.data.packageId) revalidatePath(`/paket/${parsed.data.packageId}/dokumen`);
  return { success: "Milestone diverifikasi & selesai." };
}
