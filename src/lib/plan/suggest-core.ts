import {
  classifyStage,
  detectWorkType,
  HARD_EDGES,
  stageLabel,
  stagePlannedFraction,
  type StageKey,
  type WorkType,
} from "@/lib/scurve/sequencing";

/**
 * Inti MURNI (tanpa DB / server-only) untuk saran rencana mingguan — bisa diuji
 * langsung. Logika lengkap & rasional lihat suggest.ts.
 *
 * Memakai penjadwalan BERURUT per-unit (sequencing.ts): tiap item punya TAHAP
 * dalam unitnya (kategori), dan ada GERBANG PRASYARAT — sebuah tahap tak
 * disarankan bila tahap prasyarat KERAS di unit yang sama belum cukup progres
 * (mis. jangan sarankan pasang dinding rumah genset bila pondasinya < 80%).
 */

const EPS = 1e-6;

/** Ambang progres prasyarat (nilai) sebelum tahap penerus boleh disarankan. */
const PREREQ_GATE = 0.8;

export type WeeklySuggestion = {
  rabNodeId: string;
  code: string;
  name: string;
  unit: string | null;
  categoryName: string;
  workType: WorkType;
  stage: StageKey;
  stageLabel: string;
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
function overdueWeeks(
  workType: WorkType,
  stage: StageKey,
  volume: number,
  realized: number,
  weekNumber: number,
  totalWeeks: number,
): number {
  for (let k = 0; k < weekNumber; k++) {
    const planned = stagePlannedFraction(workType, stage, k, totalWeeks) * volume;
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

  // Tipe pekerjaan PER-UNIT (kategori) — dari mayoritas item unit itu.
  const namesByCat = new Map<string, string[]>();
  for (const it of leaves) {
    const arr = namesByCat.get(it.categoryName) ?? [];
    arr.push(it.name);
    namesByCat.set(it.categoryName, arr);
  }
  const typeByCat = new Map<string, WorkType>();
  for (const [cat, names] of namesByCat) typeByCat.set(cat, detectWorkType(cat, names));

  // Tahap tiap item + rekap nilai rencana/realisasi per (unit, tahap) untuk
  // gerbang prasyarat.
  const stageOf = new Map<string, { workType: WorkType; stage: StageKey }>();
  const plannedByCatStage = new Map<string, number>(); // `${cat}|${stage}` → Σ nilai
  const realizedByCatStage = new Map<string, number>();
  for (const it of leaves) {
    if (!(it.volume > 0)) continue;
    const workType = typeByCat.get(it.categoryName) ?? "gedung";
    const stage = classifyStage(workType, it.name, it.categoryName);
    stageOf.set(it.rabNodeId, { workType, stage });
    const key = `${it.categoryName}|${stage}`;
    const realized = realizedByLineage.get(it.lineageKey) ?? 0;
    plannedByCatStage.set(key, (plannedByCatStage.get(key) ?? 0) + it.volume * it.unitPrice);
    realizedByCatStage.set(key, (realizedByCatStage.get(key) ?? 0) + realized * it.unitPrice);
  }
  /** Fraksi nilai realisasi sebuah (unit,tahap); tanpa rencana ⇒ dianggap 1 (tak menghalangi). */
  const stageRealizedFrac = (cat: string, stage: StageKey): number => {
    const key = `${cat}|${stage}`;
    const planned = plannedByCatStage.get(key) ?? 0;
    if (planned <= EPS) return 1;
    return (realizedByCatStage.get(key) ?? 0) / planned;
  };
  /** Prasyarat KERAS tahap ini di unit yang sama yang belum cukup progres. */
  const blockingPrereq = (cat: string, workType: WorkType, stage: StageKey): StageKey | null => {
    for (const [pred, succ] of HARD_EDGES[workType]) {
      if (succ !== stage) continue;
      const key = `${cat}|${pred}`;
      if ((plannedByCatStage.get(key) ?? 0) > EPS && stageRealizedFrac(cat, pred) < PREREQ_GATE) {
        return pred;
      }
    }
    return null;
  };

  for (const it of leaves) {
    if (!(it.volume > 0)) continue;
    const meta = stageOf.get(it.rabNodeId)!;
    const { workType, stage } = meta;

    const realized = realizedByLineage.get(it.lineageKey) ?? 0;
    const remaining = Math.max(0, it.volume - realized);
    if (remaining <= EPS) continue; // item sudah selesai

    // GERBANG PRASYARAT: jangan sarankan tahap penerus bila prasyarat unit ini
    // belum cukup (mis. dinding sebelum pondasi 80%). Item prasyaratnya akan
    // muncul sendiri karena jendelanya aktif/tertinggal.
    if (blockingPrereq(it.categoryName, workType, stage)) continue;

    const fracNow = stagePlannedFraction(workType, stage, weekNumber, totalWeeks);
    const fracPrev = stagePlannedFraction(workType, stage, weekNumber - 1, totalWeeks);

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
      const wk = overdueWeeks(workType, stage, it.volume, realized, weekNumber, totalWeeks);
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
      workType,
      stage,
      stageLabel: stageLabel(workType, stage),
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
