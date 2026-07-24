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
import { ADMIN_MILESTONE_TEMPLATE, LOKASI_MILESTONES, PAKET_MILESTONES } from "@/lib/milestones/template";
import type { MilestoneStatus } from "@/generated/prisma/enums";
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
  try {
    const user = await requireCapability("compliance.manage");
    await updateMilestone(
      d.milestoneId,
      {
        status: d.status,
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
  return { success: "Milestone diperbarui." };
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
