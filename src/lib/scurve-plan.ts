import { db } from "@/lib/db";
import { generateScurve } from "@/lib/scurve";
import { getActiveRevisionId } from "@/lib/rab";
import type { ScurvePlanSource } from "@prisma/client";

const DAY_MS = 24 * 3600 * 1000;

export type PlannedSeries = { weeks: number[]; plannedPct: number[] };

/**
 * Deret rencana kurva-S dari PLAN AKTIF. Fallback ke scheduled_milestones lama
 * (location-level) kalau lokasi belum punya plan — biar data lama tetap tampil.
 */
export async function getPlannedSeries(locationId: string): Promise<PlannedSeries> {
  const plan = await db.scurvePlan.findFirst({
    where: { locationId, status: "active" },
    orderBy: { planNo: "desc" },
    select: {
      milestones: {
        orderBy: { weekNumber: "asc" },
        select: { weekNumber: true, targetProgressPct: true },
      },
    },
  });
  if (plan && plan.milestones.length > 0) {
    return {
      weeks: plan.milestones.map((m) => m.weekNumber),
      plannedPct: plan.milestones.map((m) => m.targetProgressPct.toNumber()),
    };
  }
  const ms = await db.scheduledMilestone.findMany({
    where: { locationId, rabItemId: null },
    orderBy: { weekNumber: "asc" },
    select: { weekNumber: true, targetProgressPct: true },
  });
  return {
    weeks: ms.map((m) => m.weekNumber),
    plannedPct: ms.map((m) => m.targetProgressPct.toNumber()),
  };
}

/** Plan aktif + milestone + pembuat (untuk halaman Atur Kurva-S). */
export async function getActivePlan(locationId: string) {
  return db.scurvePlan.findFirst({
    where: { locationId, status: "active" },
    orderBy: { planNo: "desc" },
    include: {
      milestones: { orderBy: { weekNumber: "asc" } },
      createdBy: { select: { fullName: true } },
    },
  });
}

/** Riwayat plan (termasuk yang superseded). */
export async function getPlanHistory(locationId: string) {
  return db.scurvePlan.findMany({
    where: { locationId },
    orderBy: { planNo: "desc" },
    include: { createdBy: { select: { fullName: true } } },
  });
}

async function contractDaysFor(locationId: string): Promise<number> {
  const loc = await db.location.findUnique({
    where: { id: locationId },
    select: { contract: { select: { startDate: true, endDate: true } } },
  });
  if (!loc) return 150;
  const d = Math.round(
    (loc.contract.endDate.getTime() - loc.contract.startDate.getTime()) / DAY_MS
  );
  return Math.max(30, d);
}

/**
 * Generate plan baru dari rumus (RAB revisi aktif + durasi kontrak), jadikan
 * AKTIF, dan superseded-kan plan lama (histori tetap tersimpan). DECISIONS 027.
 */
export async function createAutoPlan(
  locationId: string,
  opts: {
    source: ScurvePlanSource;
    basedOnRevisionId?: string | null;
    createdByUserId?: string | null;
    note?: string | null;
  }
) {
  const contractDays = await contractDaysFor(locationId);
  const cats = await db.rabCategory.findMany({
    where: { locationId, revision: { status: "active" } },
    orderBy: { sortOrder: "asc" },
    select: { romanNumeral: true, name: true, totalValue: true },
  });
  const rabInput = {
    categories: cats.map((c) => ({
      roman: c.romanNumeral,
      name: c.name,
      total_value: Number(c.totalValue),
      subcategories: [],
      direct_items: [],
    })),
  };
  const result = generateScurve(rabInput, contractDays);
  const revId = opts.basedOnRevisionId ?? (await getActiveRevisionId(locationId));

  return db.$transaction(async (tx) => {
    await tx.scurvePlan.updateMany({
      where: { locationId, status: "active" },
      data: { status: "superseded", supersededAt: new Date() },
    });
    const last = await tx.scurvePlan.findFirst({
      where: { locationId },
      orderBy: { planNo: "desc" },
      select: { planNo: true },
    });
    const plan = await tx.scurvePlan.create({
      data: {
        locationId,
        planNo: (last?.planNo ?? 0) + 1,
        source: opts.source,
        status: "active",
        basedOnRevisionId: revId,
        contractDays,
        note: opts.note ?? null,
        createdByUserId: opts.createdByUserId ?? null,
      },
    });
    if (result.cumulativePct.length > 0) {
      await tx.scurveMilestone.createMany({
        data: result.cumulativePct.map((pct, i) => ({
          planId: plan.id,
          weekNumber: i + 1,
          targetProgressPct: pct,
        })),
      });
    }
    return plan;
  });
}

/** Ganti target mingguan plan aktif (edit manual) → tandai source 'manual'. */
export async function updatePlanMilestones(
  planId: string,
  rows: { weekNumber: number; pct: number }[]
) {
  await db.$transaction(async (tx) => {
    await tx.scurveMilestone.deleteMany({ where: { planId } });
    await tx.scurveMilestone.createMany({
      data: rows.map((r) => ({
        planId,
        weekNumber: r.weekNumber,
        targetProgressPct: r.pct,
      })),
    });
    await tx.scurvePlan.update({ where: { id: planId }, data: { source: "manual" } });
  });
}
