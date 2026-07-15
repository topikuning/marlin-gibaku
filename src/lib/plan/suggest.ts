import "server-only";
import { db } from "@/lib/db";
import { cumulativeVolumeByLineage, currentWeekNumber } from "@/lib/progress";
import { contractDaysFor } from "@/lib/rab/import";
import { computeSuggestions, type LeafInput, type WeeklySuggestionResult } from "./suggest-core";

/**
 * Saran rencana mingguan OTOMATIS (lapisan DB).
 *
 * Ide: tiap item RAB punya "trade" (urutan dependensi lapangan) → dari kurva-S
 * per-trade kita tahu berapa FRAKSI item itu SEHARUSNYA selesai pada akhir suatu
 * minggu. Bandingkan dengan realisasi nyata:
 *   - target normal minggu ini = kenaikan rencana minggu ini (frac_now − frac_prev) × volume
 *   - tertinggal (shortfall)    = rencana s/d minggu LALU − realisasi (bila > 0)
 * Saran volume = target normal + tertinggal (di-clamp ke sisa volume). Jadi bila
 * ADA deviasi negatif, saran otomatis MENGEJAR ketertinggalan; bila tepat jadwal,
 * saran = beban normal minggu ini. Inti murni: suggest-core.ts.
 */

export type { WeeklySuggestion, WeeklySuggestionResult } from "./suggest-core";

/** Ambil data lokasi + hitung saran rencana minggu tertentu. */
export async function suggestWeeklyPlan(
  locationId: string,
  weekNumber: number,
): Promise<WeeklySuggestionResult | null> {
  const revision = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  if (!revision) return null;

  const [nodes, realizedByLineage, contractDays, baseline, loc] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: revision.id, kind: { in: ["kategori", "item"] } },
      select: { id: true, kind: true, code: true, name: true, unit: true, volume: true, unitPrice: true, lineageKey: true },
      orderBy: { sortOrder: "asc" },
    }),
    cumulativeVolumeByLineage(locationId),
    contractDaysFor(locationId),
    db.baseline.findFirst({
      where: { locationId, status: "aktif" },
      orderBy: { baselineNo: "desc" },
      select: { points: { orderBy: { weekNumber: "asc" }, select: { weekNumber: true, plannedPct: true } } },
    }),
    db.location.findUnique({
      where: { id: locationId },
      select: { package: { select: { contract: { select: { startDate: true } } } } },
    }),
  ]);

  const totalWeeks = Math.max(1, Math.ceil(contractDays / 7));

  // categoryName per lineage (prefix terpanjang) — sama seperti regenerateBaseline.
  const catKeys = nodes
    .filter((n) => n.kind === "kategori")
    .map((n) => ({ key: n.lineageKey, name: n.name }))
    .sort((a, b) => b.key.length - a.key.length);
  const categoryNameFor = (lineageKey: string): string =>
    catKeys.find((c) => lineageKey === c.key || lineageKey.startsWith(`${c.key}#`))?.name ?? "";

  const leaves: LeafInput[] = nodes
    .filter((n) => n.kind === "item" && n.volume != null && Number(n.volume) > 0)
    .map((n) => ({
      rabNodeId: n.id,
      code: n.code,
      name: n.name,
      unit: n.unit,
      categoryName: categoryNameFor(n.lineageKey),
      volume: Number(n.volume),
      unitPrice: n.unitPrice != null ? Number(n.unitPrice) : 0,
      lineageKey: n.lineageKey,
    }));

  const suggestions = computeSuggestions(leaves, realizedByLineage, weekNumber, totalWeeks);

  // Konteks deviasi (minggu berjalan).
  const startDate = loc?.package.contract?.startDate ?? null;
  const points = baseline?.points ?? [];
  const currentWeek = startDate ? currentWeekNumber(startDate, totalWeeks) : Math.min(weekNumber, totalWeeks);
  const planPct = Number(points[currentWeek - 1]?.plannedPct ?? points[points.length - 1]?.plannedPct ?? 0);

  const grandTotal = leaves.reduce((s, l) => s + l.volume * l.unitPrice, 0);
  let realizedValue = 0;
  for (const l of leaves) realizedValue += (realizedByLineage.get(l.lineageKey) ?? 0) * l.unitPrice;
  const actualPct = grandTotal > 0 ? (realizedValue / grandTotal) * 100 : 0;
  const deviationPct = Math.round((actualPct - planPct) * 100) / 100;

  return {
    weekNumber,
    totalWeeks,
    planPct: Math.round(planPct * 100) / 100,
    actualPct: Math.round(actualPct * 100) / 100,
    deviationPct,
    behind: deviationPct < -0.01,
    suggestions,
  };
}
