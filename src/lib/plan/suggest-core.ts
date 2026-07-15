import { classifyTrade, tradeLabel, tradePlannedFraction, type TradeKey } from "@/lib/scurve/generate";

/**
 * Inti MURNI (tanpa DB / server-only) untuk saran rencana mingguan — bisa diuji
 * langsung. Logika lengkap & rasional lihat suggest.ts.
 */

const EPS = 1e-6;

export type WeeklySuggestion = {
  rabNodeId: string;
  code: string;
  name: string;
  unit: string | null;
  categoryName: string;
  trade: TradeKey;
  tradeLabel: string;
  rabVolume: number;
  realizedVolume: number;
  remainingVolume: number;
  /** Saran volume utk dikerjakan minggu ini (sudah termasuk kejar tertinggal). */
  targetVolume: number;
  /** Bagian target yang bersifat mengejar ketertinggalan. */
  catchUpVolume: number;
  priority: number;
  /** Nilai rupiah target (targetVolume × unitPrice). */
  valueTarget: number;
  reason: string;
};

export type WeeklySuggestionResult = {
  weekNumber: number;
  totalWeeks: number;
  /** Rencana kumulatif % s/d akhir minggu berjalan. */
  planPct: number;
  /** Realisasi kumulatif % (nilai) saat ini. */
  actualPct: number;
  /** actual − plan; negatif = tertinggal. */
  deviationPct: number;
  behind: boolean;
  suggestions: WeeklySuggestion[];
};

export type LeafInput = {
  rabNodeId: string;
  code: string;
  name: string;
  unit: string | null;
  categoryName: string;
  volume: number;
  unitPrice: number;
  lineageKey: string;
};

/** Estimasi berapa minggu sebuah item tertinggal (utk alasan yang informatif). */
function overdueWeeks(trade: TradeKey, volume: number, realized: number, weekNumber: number, totalWeeks: number): number {
  for (let k = 0; k < weekNumber; k++) {
    const planned = tradePlannedFraction(trade, k, totalWeeks) * volume;
    if (planned > realized + EPS) return weekNumber - 1 - k;
  }
  return 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Menghasilkan saran terurut (paling berdampak menutup deviasi di atas).
 *   target = kenaikan rencana minggu ini + tertinggal (clamp ke sisa volume).
 */
export function computeSuggestions(
  leaves: LeafInput[],
  realizedByLineage: Map<string, number>,
  weekNumber: number,
  totalWeeks: number,
  maxSuggestions = 20,
): WeeklySuggestion[] {
  const raw: (WeeklySuggestion & { rankScore: number })[] = [];

  for (const it of leaves) {
    if (!(it.volume > 0)) continue;
    const trade = classifyTrade(it.name, it.categoryName);
    const fracNow = tradePlannedFraction(trade, weekNumber, totalWeeks);
    const fracPrev = tradePlannedFraction(trade, weekNumber - 1, totalWeeks);

    const realized = realizedByLineage.get(it.lineageKey) ?? 0;
    const remaining = Math.max(0, it.volume - realized);
    if (remaining <= EPS) continue; // item sudah selesai

    const incrementalThisWeek = Math.max(0, (fracNow - fracPrev) * it.volume);
    const plannedByLastWeek = fracPrev * it.volume;
    const shortfall = Math.max(0, plannedByLastWeek - realized);

    // Hanya sarankan item yang aktif minggu ini ATAU tertinggal (jendela mulai).
    if (incrementalThisWeek <= EPS && shortfall <= EPS) continue;

    const targetVolume = Math.min(remaining, incrementalThisWeek + shortfall);
    if (targetVolume <= EPS) continue;
    const catchUpVolume = Math.min(shortfall, remaining);
    const valueTarget = Math.round(targetVolume * it.unitPrice);

    let reason: string;
    if (shortfall > EPS) {
      const wk = overdueWeeks(trade, it.volume, realized, weekNumber, totalWeeks);
      reason = wk > 0 ? `Tertinggal ~${wk} mgg — kejar` : "Tertinggal — kejar";
    } else if (fracPrev <= EPS && fracNow > EPS) {
      reason = "Mulai minggu ini";
    } else {
      reason = "Sesuai jadwal";
    }

    const rankScore = valueTarget + catchUpVolume * it.unitPrice * 1.5;

    raw.push({
      rabNodeId: it.rabNodeId,
      code: it.code,
      name: it.name,
      unit: it.unit,
      categoryName: it.categoryName,
      trade,
      tradeLabel: tradeLabel(trade),
      rabVolume: round3(it.volume),
      realizedVolume: round3(realized),
      remainingVolume: round3(remaining),
      targetVolume: round3(targetVolume),
      catchUpVolume: round3(catchUpVolume),
      priority: 5,
      valueTarget,
      reason,
      rankScore,
    });
  }

  raw.sort((a, b) => b.rankScore - a.rankScore);
  const top = raw.slice(0, maxSuggestions);
  const bucket = Math.max(1, Math.ceil(top.length / 9));
  return top.map((s, i) => {
    const { rankScore: _rankScore, ...rest } = s;
    void _rankScore;
    return { ...rest, priority: Math.min(9, Math.floor(i / bucket) + 1) };
  });
}
