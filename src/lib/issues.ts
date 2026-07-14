"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess, ForbiddenError, type SessionUser } from "@/lib/auth/session";

/**
 * Server actions kendala (Issue) + aksi pemulihan (RecoveryAction/Update).
 * Semua mutasi: capability issue.manage + scope lokasi + zod + audit +
 * revalidatePath. Dipakai dari halaman /lokasi/[slug]/progress.
 */

export type IssueActionState = { error?: string; success?: string } | undefined;

const SEVERITIES = ["rendah", "sedang", "tinggi", "kritis"] as const;
const ISSUE_STATUSES = ["terbuka", "ditangani", "selesai"] as const;
const RECOVERY_STATUSES = ["direncanakan", "berjalan", "selesai", "batal"] as const;

async function guard(locationId: string): Promise<{ user: SessionUser; slug: string }> {
  const user = await requireCapability("issue.manage");
  await requireLocationAccess(user, locationId);
  const loc = await db.location.findUniqueOrThrow({
    where: { id: locationId },
    select: { slug: true },
  });
  return { user, slug: loc.slug };
}

function revalidateLocation(slug: string): void {
  revalidatePath(`/lokasi/${slug}/progress`);
  revalidatePath(`/lokasi/${slug}`);
}

function fail(err: unknown): IssueActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const createIssueSchema = z.object({
  locationId: z.uuid(),
  title: z.string().trim().min(3, "Judul kendala minimal 3 karakter").max(200),
  description: z.string().trim().max(2000).optional(),
  severity: z.enum(SEVERITIES),
});

export async function createIssue(_prev: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const parsed = createIssueSchema.safeParse({
    locationId: formData.get("locationId"),
    title: formData.get("title"),
    description: String(formData.get("description") ?? "").trim() || undefined,
    severity: formData.get("severity"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const { user, slug } = await guard(d.locationId);
    const issue = await db.issue.create({
      data: {
        locationId: d.locationId,
        title: d.title,
        description: d.description ?? null,
        severity: d.severity,
        raisedById: user.id,
      },
    });
    await audit(user.id, "issue.create", "issue", issue.id, {
      locationId: d.locationId,
      severity: d.severity,
    });
    revalidateLocation(slug);
    return { success: "Kendala dicatat." };
  } catch (err) {
    return fail(err);
  }
}

const updateIssueStatusSchema = z.object({
  issueId: z.uuid(),
  status: z.enum(ISSUE_STATUSES),
});

export async function updateIssueStatus(_prev: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const parsed = updateIssueStatusSchema.safeParse({
    issueId: formData.get("issueId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const issue = await db.issue.findUniqueOrThrow({
      where: { id: parsed.data.issueId },
      select: { id: true, locationId: true, status: true },
    });
    const { user, slug } = await guard(issue.locationId);
    await db.issue.update({
      where: { id: issue.id },
      data: { status: parsed.data.status },
    });
    await audit(user.id, "issue.update_status", "issue", issue.id, {
      from: issue.status,
      to: parsed.data.status,
    });
    revalidateLocation(slug);
    return { success: `Status kendala → ${parsed.data.status}.` };
  } catch (err) {
    return fail(err);
  }
}

const addRecoveryActionSchema = z.object({
  issueId: z.uuid(),
  description: z.string().trim().min(3, "Uraian aksi minimal 3 karakter").max(2000),
  picName: z.string().trim().max(120).optional(),
  dueDate: z.iso.date("Tanggal target tidak valid").optional(),
});

export async function addRecoveryAction(_prev: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const parsed = addRecoveryActionSchema.safeParse({
    issueId: formData.get("issueId"),
    description: formData.get("description"),
    picName: String(formData.get("picName") ?? "").trim() || undefined,
    dueDate: String(formData.get("dueDate") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const issue = await db.issue.findUniqueOrThrow({
      where: { id: d.issueId },
      select: { id: true, locationId: true, status: true },
    });
    const { user, slug } = await guard(issue.locationId);
    const action = await db.recoveryAction.create({
      data: {
        issueId: issue.id,
        description: d.description,
        picName: d.picName ?? null,
        dueDate: d.dueDate ? new Date(`${d.dueDate}T00:00:00.000Z`) : null,
        createdById: user.id,
      },
    });
    // Kendala yang sudah punya aksi pemulihan otomatis "ditangani".
    if (issue.status === "terbuka") {
      await db.issue.update({ where: { id: issue.id }, data: { status: "ditangani" } });
    }
    await audit(user.id, "issue.add_recovery_action", "recovery_action", action.id, {
      issueId: issue.id,
    });
    revalidateLocation(slug);
    return { success: "Aksi pemulihan ditambahkan." };
  } catch (err) {
    return fail(err);
  }
}

const updateRecoveryStatusSchema = z.object({
  actionId: z.uuid(),
  status: z.enum(RECOVERY_STATUSES),
});

export async function updateRecoveryStatus(_prev: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const parsed = updateRecoveryStatusSchema.safeParse({
    actionId: formData.get("actionId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const action = await db.recoveryAction.findUniqueOrThrow({
      where: { id: parsed.data.actionId },
      select: { id: true, status: true, issue: { select: { id: true, locationId: true } } },
    });
    const { user, slug } = await guard(action.issue.locationId);
    await db.recoveryAction.update({
      where: { id: action.id },
      data: { status: parsed.data.status },
    });
    await audit(user.id, "issue.update_recovery_status", "recovery_action", action.id, {
      issueId: action.issue.id,
      from: action.status,
      to: parsed.data.status,
    });
    revalidateLocation(slug);
    return { success: `Status aksi → ${parsed.data.status}.` };
  } catch (err) {
    return fail(err);
  }
}

const addRecoveryUpdateSchema = z.object({
  actionId: z.uuid(),
  note: z.string().trim().min(2, "Catatan perkembangan wajib diisi").max(2000),
});

export async function addRecoveryUpdate(_prev: IssueActionState, formData: FormData): Promise<IssueActionState> {
  const parsed = addRecoveryUpdateSchema.safeParse({
    actionId: formData.get("actionId"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const action = await db.recoveryAction.findUniqueOrThrow({
      where: { id: parsed.data.actionId },
      select: { id: true, issue: { select: { id: true, locationId: true } } },
    });
    const { user, slug } = await guard(action.issue.locationId);
    const update = await db.recoveryUpdate.create({
      data: { actionId: action.id, note: parsed.data.note, createdById: user.id },
    });
    await audit(user.id, "issue.add_recovery_update", "recovery_update", update.id, {
      actionId: action.id,
      issueId: action.issue.id,
    });
    revalidateLocation(slug);
    return { success: "Perkembangan dicatat." };
  } catch (err) {
    return fail(err);
  }
}
