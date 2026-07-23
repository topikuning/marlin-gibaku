"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess, ForbiddenError } from "@/lib/auth/session";
import { activateRevision, discardDraft, regenerateBaseline } from "@/lib/rab/import";
import { updateBaselinePoints, validateBaselinePoints } from "@/lib/baseline";
import { suggestWeeklyPlan, type WeeklySuggestionResult } from "@/lib/plan/suggest";

export type RabActionState = { error?: string; success?: string } | undefined;

export type SuggestState =
  | { error?: string; result?: WeeklySuggestionResult }
  | undefined;

function fail(err: unknown): RabActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

function revalidateRab(slug: string): void {
  // Header lokasi (plan/aktual) ikut berubah → revalidate seluruh subtree.
  revalidatePath(`/lokasi/${slug}`, "layout");
  revalidatePath("/lokasi");
}

/**
 * Ganti judul KATEGORI RAB — mis. memperbaiki kategori yang di file tak punya
 * baris judul (placeholder "PEKERJAAN (kategori … judul tidak ada di file)").
 * Hanya metadata nama; tak menyentuh nilai/lineage → baseline tak berubah.
 */
export async function renameRabCategoryAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsedId = z.uuid().safeParse(formData.get("nodeId"));
  if (!parsedId.success) return { error: "Node RAB tidak valid." };
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Judul minimal 2 karakter." };
  try {
    const user = await requireCapability("rab.manage");
    const node = await db.rabNode.findUniqueOrThrow({
      where: { id: parsedId.data },
      select: {
        id: true,
        kind: true,
        revision: { select: { locationId: true, location: { select: { slug: true } } } },
      },
    });
    if (node.kind !== "kategori") return { error: "Hanya judul kategori yang bisa diganti di sini." };
    await requireLocationAccess(user, node.revision.locationId);
    await db.rabNode.update({ where: { id: node.id }, data: { name: name.slice(0, 200) } });
    await audit(user.id, "rab.rename_category", "rab_node", node.id, { name: name.slice(0, 200) });
    revalidateRab(node.revision.location.slug);
    return { success: "Judul kategori diperbarui." };
  } catch (err) {
    return fail(err);
  }
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

/**
 * Hitung ulang kurva-S (baseline) dari revisi RAB aktif — versi baru (append-only,
 * baseline lama jadi "digantikan"). Dipakai bila jadwal perlu disegarkan tanpa
 * mengganti RAB. Realisasi tetap tersambung by lineage.
 */
export async function recalcBaselineAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = z.uuid().safeParse(formData.get("locationId"));
  if (!parsed.success) return { error: "Lokasi tidak valid." };
  try {
    const user = await requireCapability("baseline.manage");
    await requireLocationAccess(user, parsed.data);
    const loc = await db.location.findUniqueOrThrow({
      where: { id: parsed.data },
      select: { slug: true },
    });
    const active = await db.rabRevision.findFirst({
      where: { locationId: parsed.data, status: "aktif" },
      select: { id: true },
    });
    if (!active) return { error: "Belum ada revisi RAB aktif — import RAB dulu." };
    const baseline = await regenerateBaseline(parsed.data, {
      source: "auto",
      rabRevisionId: active.id,
      note: "Hitung ulang kurva-S manual",
      userId: user.id,
    });
    revalidateRab(loc.slug);
    revalidatePath(`/lokasi/${loc.slug}/progress`);
    return { success: `Kurva-S dihitung ulang — baseline #${baseline.baselineNo} aktif.` };
  } catch (err) {
    return fail(err);
  }
}

const saveManualBaselineSchema = z.object({
  baselineId: z.uuid(),
  locationId: z.uuid(),
  points: z
    .array(z.number())
    .min(1, "Deret rencana kosong.")
    .max(520, "Terlalu banyak minggu."),
});

/**
 * Simpan kurva-S hasil edit manual → baseline BARU source "manual" (append-only,
 * baseline lama digantikan). Server memvalidasi ulang deret (monoton, 0..100,
 * akhir 100) — tidak percaya klien.
 */
export async function saveManualBaselineAction(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  let pointsRaw: unknown;
  try {
    pointsRaw = JSON.parse(String(formData.get("points") ?? "[]"));
  } catch {
    return { error: "Data kurva tidak valid." };
  }
  const parsed = saveManualBaselineSchema.safeParse({
    baselineId: formData.get("baselineId"),
    locationId: formData.get("locationId"),
    points: pointsRaw,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { baselineId, locationId, points } = parsed.data;

  // Validasi bentuk kurva sebelum menyentuh DB (pesan lebih informatif).
  const invalid = validateBaselinePoints(points);
  if (invalid) return { error: invalid };

  try {
    const user = await requireCapability("baseline.manage");
    await requireLocationAccess(user, locationId);
    // Baseline acuan harus milik lokasi ini (cegah lintas-lokasi).
    const ref = await db.baseline.findUniqueOrThrow({
      where: { id: baselineId },
      select: { locationId: true, location: { select: { slug: true } } },
    });
    if (ref.locationId !== locationId) return { error: "Baseline bukan milik lokasi ini." };

    const baseline = await updateBaselinePoints(baselineId, points, user.id);
    revalidateRab(ref.location.slug);
    revalidatePath(`/lokasi/${ref.location.slug}/progress`);
    return { success: `Kurva-S manual disimpan — baseline #${baseline.baselineNo} aktif.` };
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

const suggestSchema = z.object({
  locationId: z.uuid(),
  weekNumber: z.coerce.number().int().min(1).max(520),
});

/** Hitung saran rencana mingguan otomatis (tanpa menyimpan) — utk pratinjau. */
export async function getWeeklySuggestions(_prev: SuggestState, formData: FormData): Promise<SuggestState> {
  const parsed = suggestSchema.safeParse({
    locationId: formData.get("locationId"),
    weekNumber: formData.get("weekNumber"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await requireCapability("weekly_plan.manage");
    await requireLocationAccess(user, parsed.data.locationId);
    const result = await suggestWeeklyPlan(parsed.data.locationId, parsed.data.weekNumber);
    if (!result) return { error: "Belum ada revisi RAB aktif — impor RAB dulu." };
    if (result.suggestions.length === 0) {
      return { error: "Tidak ada pekerjaan yang perlu disarankan untuk minggu ini (semua sesuai/selesai)." };
    }
    return { result };
  } catch (err) {
    const e = fail(err);
    return { error: e?.error };
  }
}

/**
 * Terapkan saran otomatis → upsert WeeklyPlanItem utk minggu itu. Saran
 * DIHITUNG ULANG di server (tidak percaya payload klien). Item yang sudah ada
 * di rencana minggu itu di-update targetnya; sisanya dibuat.
 */
export async function applyWeeklySuggestions(_prev: RabActionState, formData: FormData): Promise<RabActionState> {
  const parsed = suggestSchema.safeParse({
    locationId: formData.get("locationId"),
    weekNumber: formData.get("weekNumber"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { locationId, weekNumber } = parsed.data;
  try {
    const user = await requireCapability("weekly_plan.manage");
    await requireLocationAccess(user, locationId);

    const location = await db.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { slug: true, package: { select: { contract: { select: { startDate: true } } } } },
    });
    const startDate = location.package.contract?.startDate;
    if (!startDate) return { error: "Paket belum punya kontrak — periode minggu tidak bisa dihitung." };

    const result = await suggestWeeklyPlan(locationId, weekNumber);
    if (!result || result.suggestions.length === 0) {
      return { error: "Tidak ada saran untuk diterapkan." };
    }

    const weekStart = new Date(startDate.getTime() + (weekNumber - 1) * 7 * DAY_MS);
    const weekEnd = new Date(weekStart.getTime() + 6 * DAY_MS);
    const plan = await db.weeklyPlan.upsert({
      where: { locationId_weekNumber: { locationId, weekNumber } },
      update: {},
      create: { locationId, weekNumber, weekStart, weekEnd, createdById: user.id },
    });

    for (const s of result.suggestions) {
      await db.weeklyPlanItem.upsert({
        where: { weeklyPlanId_rabNodeId: { weeklyPlanId: plan.id, rabNodeId: s.rabNodeId } },
        update: { targetVolume: s.targetVolume, priority: s.priority, note: s.reason },
        create: {
          weeklyPlanId: plan.id,
          rabNodeId: s.rabNodeId,
          targetVolume: s.targetVolume,
          priority: s.priority,
          note: s.reason,
        },
      });
    }
    await audit(user.id, "weekly_plan.apply_suggestions", "weekly_plan", plan.id, {
      locationId,
      weekNumber,
      count: result.suggestions.length,
      behind: result.behind,
      deviationPct: result.deviationPct,
    });
    revalidatePath(`/lokasi/${location.slug}/rab`);
    revalidatePath(`/lokasi/${location.slug}`);
    return {
      success: `${result.suggestions.length} pekerjaan disarankan masuk rencana minggu ${weekNumber}${
        result.behind ? ` (mengejar deviasi ${result.deviationPct}%)` : ""
      }. Silakan sesuaikan bila perlu.`,
    };
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
