"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess, ForbiddenError } from "@/lib/auth/session";
import { activateRevision, discardDraft, regenerateBaseline } from "@/lib/rab/import";

export type RabActionState = { error?: string; success?: string } | undefined;

function fail(err: unknown): RabActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

function revalidateRab(slug: string): void {
  // Header lokasi (plan/aktual) ikut berubah → revalidate seluruh subtree.
  revalidatePath(`/lokasi/${slug}`, "layout");
  revalidatePath("/lokasi");
}

/** Aktifkan revisi draft → revisi aktif lama digantikan + baseline di-regenerate. */
export async function activateDraftAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = z.uuid().safeParse(formData.get("revisionId"));
  if (!parsed.success) return { error: "Revisi tidak valid." };
  try {
    const user = await requireCapability("rab.manage");
    const rev = await db.rabRevision.findUniqueOrThrow({
      where: { id: parsed.data },
      select: { id: true, locationId: true, revisionNo: true, source: true, location: { select: { slug: true } } },
    });
    await requireLocationAccess(user, rev.locationId);
    await activateRevision(rev.id, user.id);
    await regenerateBaseline(rev.locationId, {
      source: rev.source === "adendum" ? "adendum" : "auto",
      rabRevisionId: rev.id,
      note: `Regenerate otomatis (aktivasi revisi #${rev.revisionNo})`,
      userId: user.id,
    });
    revalidateRab(rev.location.slug);
    return { success: `Revisi #${rev.revisionNo} aktif. Baseline kurva-S di-regenerate.` };
  } catch (err) {
    return fail(err);
  }
}

/** Buang revisi draft (beserta seluruh node-nya). */
export async function discardDraftAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = z.uuid().safeParse(formData.get("revisionId"));
  if (!parsed.success) return { error: "Revisi tidak valid." };
  try {
    const user = await requireCapability("rab.manage");
    const rev = await db.rabRevision.findUniqueOrThrow({
      where: { id: parsed.data },
      select: { id: true, locationId: true, location: { select: { slug: true } } },
    });
    await requireLocationAccess(user, rev.locationId);
    const discarded = await discardDraft(rev.id, user.id);
    revalidateRab(rev.location.slug);
    return { success: `Draft revisi #${discarded.revisionNo} dibuang.` };
  } catch (err) {
    return fail(err);
  }
}

// ── Rencana mingguan ────────────────────────────────────────────────────────

const DAY_MS = 24 * 3600 * 1000;

const addPlanItemSchema = z.object({
  locationId: z.uuid(),
  weekNumber: z.coerce.number().int().min(1).max(520),
  rabNodeId: z.uuid("Pilih item pekerjaan dari daftar."),
  targetVolume: z.coerce.number().positive("Target volume harus > 0"),
  priority: z.coerce.number().int().min(1).max(9).default(5),
  picName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Tambah/perbarui item rencana mingguan (upsert by minggu + item RAB). */
export async function addWeeklyPlanItem(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = addPlanItemSchema.safeParse({
    locationId: formData.get("locationId"),
    weekNumber: formData.get("weekNumber"),
    rabNodeId: formData.get("rabNodeId"),
    targetVolume: formData.get("targetVolume"),
    priority: formData.get("priority") || 5,
    picName: String(formData.get("picName") ?? "").trim() || undefined,
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("weekly_plan.manage");
    await requireLocationAccess(user, d.locationId);

    const location = await db.location.findUniqueOrThrow({
      where: { id: d.locationId },
      select: {
        slug: true,
        package: { select: { contract: { select: { startDate: true } } } },
      },
    });
    const startDate = location.package.contract?.startDate;
    if (!startDate) {
      return { error: "Paket belum punya kontrak — periode minggu tidak bisa dihitung." };
    }

    // Item harus milik revisi RAB AKTIF lokasi ini dan berjenis leaf item.
    const node = await db.rabNode.findFirst({
      where: {
        id: d.rabNodeId,
        kind: "item",
        revision: { locationId: d.locationId, status: "aktif" },
      },
      select: { id: true, name: true, code: true },
    });
    if (!node) return { error: "Item RAB tidak ditemukan di revisi aktif lokasi ini." };

    const weekStart = new Date(startDate.getTime() + (d.weekNumber - 1) * 7 * DAY_MS);
    const weekEnd = new Date(weekStart.getTime() + 6 * DAY_MS);

    const plan = await db.weeklyPlan.upsert({
      where: { locationId_weekNumber: { locationId: d.locationId, weekNumber: d.weekNumber } },
      update: {},
      create: {
        locationId: d.locationId,
        weekNumber: d.weekNumber,
        weekStart,
        weekEnd,
        createdById: user.id,
      },
    });
    const item = await db.weeklyPlanItem.upsert({
      where: { weeklyPlanId_rabNodeId: { weeklyPlanId: plan.id, rabNodeId: node.id } },
      update: {
        targetVolume: d.targetVolume,
        priority: d.priority,
        picName: d.picName ?? null,
        note: d.note ?? null,
      },
      create: {
        weeklyPlanId: plan.id,
        rabNodeId: node.id,
        targetVolume: d.targetVolume,
        priority: d.priority,
        picName: d.picName ?? null,
        note: d.note ?? null,
      },
    });
    await audit(user.id, "weekly_plan.item_upsert", "weekly_plan_item", item.id, {
      locationId: d.locationId,
      weekNumber: d.weekNumber,
      rabNodeId: node.id,
      targetVolume: d.targetVolume,
    });
    revalidatePath(`/lokasi/${location.slug}/rab`);
    revalidatePath(`/lokasi/${location.slug}`);
    return { success: `${node.code} ${node.name} masuk rencana minggu ${d.weekNumber}.` };
  } catch (err) {
    return fail(err);
  }
}

/** Hapus item rencana mingguan. */
export async function removeWeeklyPlanItem(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = z.uuid().safeParse(formData.get("itemId"));
  if (!parsed.success) return { error: "Item tidak valid." };
  try {
    const user = await requireCapability("weekly_plan.manage");
    const item = await db.weeklyPlanItem.findUniqueOrThrow({
      where: { id: parsed.data },
      select: {
        id: true,
        plan: { select: { weekNumber: true, locationId: true, location: { select: { slug: true } } } },
      },
    });
    await requireLocationAccess(user, item.plan.locationId);
    await db.weeklyPlanItem.delete({ where: { id: item.id } });
    await audit(user.id, "weekly_plan.item_remove", "weekly_plan_item", item.id, {
      locationId: item.plan.locationId,
      weekNumber: item.plan.weekNumber,
    });
    revalidatePath(`/lokasi/${item.plan.location.slug}/rab`);
    revalidatePath(`/lokasi/${item.plan.location.slug}`);
    return { success: "Item rencana dihapus." };
  } catch (err) {
    return fail(err);
  }
}
