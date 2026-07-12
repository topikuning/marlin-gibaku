import { db } from "@/lib/db";
import { generateScurve } from "@/lib/scurve";
import { getActiveRevisionId } from "@/lib/rab";
import { scheduleItems, type WorkItem, type WeekSuggestion } from "@/lib/scheduling";
import type { ScurvePlanSource } from "@prisma/client";

const DAY_MS = 24 * 3600 * 1000;

/**
 * Item pekerjaan (leaf) revisi aktif + nilai + nama kategori — untuk pembobotan
 * per item. Leaf = item tanpa anak (bukan header/agregat) supaya tidak dobel.
 */
export async function getLeafWorkItems(locationId: string): Promise<WorkItem[]> {
  const cats = await db.rabCategory.findMany({
    where: { locationId, revision: { status: "active" } },
    select: { id: true, name: true, subcategories: { select: { id: true } } },
  });
  const nameByCat = new Map(cats.map((c) => [c.id, c.name]));
  const nameBySub = new Map<string, string>();
  for (const c of cats) for (const s of c.subcategories) nameBySub.set(s.id, c.name);

  const catIds = cats.map((c) => c.id);
  const subIds = [...nameBySub.keys()];
  const sel = {
    id: true,
    name: true,
    parentItemId: true,
    categoryId: true,
    subcategoryId: true,
    totalPrice: true,
  } as const;

  type Row = {
    id: string;
    name: string;
    parentItemId: string | null;
    categoryId: string | null;
    subcategoryId: string | null;
    totalPrice: import("@prisma/client").Prisma.Decimal | null;
  };
  const all: Row[] = [];
  const catNameByItem = new Map<string, string>();
  const attach = (it: Row) => {
    const cn = it.categoryId
      ? nameByCat.get(it.categoryId)
      : it.subcategoryId
        ? nameBySub.get(it.subcategoryId)
        : it.parentItemId
          ? catNameByItem.get(it.parentItemId)
          : undefined;
    if (cn) catNameByItem.set(it.id, cn);
  };

  let frontier: Row[] = await db.rabItem.findMany({
    where: { OR: [{ categoryId: { in: catIds } }, { subcategoryId: { in: subIds } }] },
    orderBy: { sortOrder: "asc" },
    select: sel,
  });
  frontier.forEach(attach);
  all.push(...frontier);
  while (frontier.length > 0) {
    const ids = frontier.map((i) => i.id);
    frontier = await db.rabItem.findMany({
      where: { parentItemId: { in: ids } },
      orderBy: { sortOrder: "asc" },
      select: sel,
    });
    frontier.forEach(attach);
    all.push(...frontier);
  }

  const parents = new Set(all.map((i) => i.parentItemId).filter((x): x is string => !!x));
  return all
    .filter((i) => !parents.has(i.id) && i.totalPrice != null && i.totalPrice.toNumber() > 0)
    .map((i) => ({
      name: i.name,
      categoryName: catNameByItem.get(i.id) ?? "",
      value: i.totalPrice!.toNumber(),
    }));
}

/** Saran pekerjaan per minggu dari penjadwalan per item (DECISIONS 028). */
export async function getWeeklySuggestions(
  locationId: string
): Promise<{ weekly: WeekSuggestion[]; classifiedPct: number; totalWeeks: number }> {
  const [items, planned] = await Promise.all([
    getLeafWorkItems(locationId),
    getPlannedSeries(locationId),
  ]);
  const totalWeeks = planned.plannedPct.length || Math.ceil((await contractDaysFor(locationId)) / 7);
  const res = scheduleItems(items, totalWeeks);
  return { weekly: res.weekly, classifiedPct: res.classifiedPct, totalWeeks: res.totalWeeks };
}

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
  const totalWeeks = Math.max(1, Math.ceil(contractDays / 7));

  // Pembobotan PER ITEM + jadwal dependensi (DECISIONS 028). Fallback ke
  // level-kategori kalau item leaf belum ada.
  const items = await getLeafWorkItems(locationId);
  let cumulativePct: number[];
  if (items.length > 0) {
    cumulativePct = scheduleItems(items, totalWeeks).cumulativePct;
  } else {
    const cats = await db.rabCategory.findMany({
      where: { locationId, revision: { status: "active" } },
      orderBy: { sortOrder: "asc" },
      select: { romanNumeral: true, name: true, totalValue: true },
    });
    cumulativePct = generateScurve(
      {
        categories: cats.map((c) => ({
          roman: c.romanNumeral,
          name: c.name,
          total_value: Number(c.totalValue),
          subcategories: [],
          direct_items: [],
        })),
      },
      contractDays
    ).cumulativePct;
  }
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
    if (cumulativePct.length > 0) {
      await tx.scurveMilestone.createMany({
        data: cumulativePct.map((pct, i) => ({
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
