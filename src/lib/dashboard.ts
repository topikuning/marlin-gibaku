import { db } from "@/lib/db";
import { PENDING_STATES } from "@/lib/report";

/** Peta rabItemId → locationId untuk lokasi tertentu (revisi aktif), 1 set query. */
async function reportableItemLocationMap(locationIds: string[]): Promise<Map<string, string>> {
  if (locationIds.length === 0) return new Map();
  const cats = await db.rabCategory.findMany({
    where: { locationId: { in: locationIds }, revision: { status: "active" } },
    select: { id: true, locationId: true, subcategories: { select: { id: true } } },
  });
  const catLoc = new Map<string, string>();
  const subLoc = new Map<string, string>();
  for (const c of cats) {
    catLoc.set(c.id, c.locationId);
    for (const s of c.subcategories) subLoc.set(s.id, c.locationId);
  }
  const sel = { id: true, categoryId: true, subcategoryId: true, parentItemId: true } as const;
  const itemLoc = new Map<string, string>();
  const attach = (it: { id: string; categoryId: string | null; subcategoryId: string | null; parentItemId: string | null }) => {
    const l = it.categoryId
      ? catLoc.get(it.categoryId)
      : it.subcategoryId
        ? subLoc.get(it.subcategoryId)
        : it.parentItemId
          ? itemLoc.get(it.parentItemId)
          : undefined;
    if (l) itemLoc.set(it.id, l);
  };
  let frontier = await db.rabItem.findMany({
    where: { OR: [{ categoryId: { in: [...catLoc.keys()] } }, { subcategoryId: { in: [...subLoc.keys()] } }] },
    orderBy: { sortOrder: "asc" },
    select: sel,
  });
  frontier.forEach(attach);
  while (frontier.length > 0) {
    const ids = frontier.map((i) => i.id);
    frontier = await db.rabItem.findMany({ where: { parentItemId: { in: ids } }, select: sel });
    frontier.forEach(attach);
  }
  return itemLoc;
}

export type ActivityRow = {
  id: string;
  itemName: string;
  volume: string;
  unit: string;
  by: string;
  locationName: string;
  state: string;
  at: Date;
};

export type PortfolioExtras = {
  pendingCount: number;
  recent: ActivityRow[];
};

/** Persetujuan tertunda + aktivitas terakhir untuk kumpulan lokasi. */
export async function getPortfolioExtras(
  locations: { id: string; name: string }[]
): Promise<PortfolioExtras> {
  const nameById = new Map(locations.map((l) => [l.id, l.name]));
  const itemLoc = await reportableItemLocationMap(locations.map((l) => l.id));
  const itemIds = [...itemLoc.keys()];
  if (itemIds.length === 0) return { pendingCount: 0, recent: [] };

  const [pendingCount, recentRows] = await Promise.all([
    db.dailyReportItem.count({ where: { rabItemId: { in: itemIds }, state: { in: PENDING_STATES } } }),
    db.dailyReportItem.findMany({
      where: { rabItemId: { in: itemIds } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        rabItem: { select: { name: true, unit: true } },
        suggestedBy: { select: { fullName: true } },
      },
    }),
  ]);

  const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
  const recent: ActivityRow[] = recentRows.map((r) => ({
    id: r.id,
    itemName: r.rabItem.name,
    volume: volFmt.format(r.volumeDone.toNumber()),
    unit: r.rabItem.unit ?? "",
    by: r.suggestedBy?.fullName ?? "—",
    locationName: nameById.get(itemLoc.get(r.rabItemId) ?? "") ?? "",
    state: r.state,
    at: r.createdAt,
  }));

  return { pendingCount, recent };
}

/** Perkiraan penyelesaian dari laju realisasi. */
export function forecast(realizedPct: number, weekNumber: number, totalWeeks: number): {
  finishWeek: number | null;
  delayWeeks: number | null;
  label: string;
} {
  if (totalWeeks <= 0) return { finishWeek: null, delayWeeks: null, label: "—" };
  if (realizedPct <= 0.01) return { finishWeek: null, delayWeeks: null, label: "belum ada realisasi" };
  const pace = realizedPct / weekNumber; // % per minggu
  const finishWeek = Math.ceil(100 / pace);
  const delay = finishWeek - totalWeeks;
  // Laju terlalu lambat / baru mulai → forecast tak bermakna, hindari angka absurd.
  if (realizedPct < 2 || finishWeek > totalWeeks * 3) {
    return { finishWeek: null, delayWeeks: delay, label: "laju sangat lambat / terlalu dini" };
  }
  if (delay <= 0) return { finishWeek, delayWeeks: delay, label: `± sesuai (mgg ${finishWeek})` };
  return { finishWeek, delayWeeks: delay, label: `telat ~${delay} mgg (mgg ${finishWeek})` };
}
