/**
 * KNMP Monitor · S-Curve Auto-Generator
 *
 * Port dari scripts/scurve.py — algoritma sama, hasil identik.
 *
 * Input: RAB parsed dari HPS + durasi kontrak (hari)
 * Output: weekly cumulative %, per-category timeline, per-item weekly volume
 *
 * Method:
 *   1. Setiap kategori RAB di-map ke phase window (start%, end% dari durasi)
 *      berdasarkan urutan konstruksi standar KNMP.
 *   2. Distribusi bobot pakai cubic smoothstep (3t² - 2t³) untuk S-shape.
 *   3. Sum semua kategori per minggu = weekly delta.
 *
 * See PROJECT.md section 6 for weakness/roadmap.
 */

export const DEFAULT_CONTRACT_DAYS = 150;

// Category name keyword → [phase_start_pct, phase_end_pct]
// First match wins. Based on standard KNMP construction sequence.
const CATEGORY_PHASE: ReadonlyArray<readonly [string, number, number]> = [
  ["PERSIAPAN", 0.0, 0.18],
  ["LEVELLING", 0.05, 0.28],
  ["REVETMENT", 0.1, 0.55],
  ["DINDING PENAHAN", 0.15, 0.6],
  ["TAMBATAN", 0.15, 0.6],
  ["DOCKING", 0.2, 0.75],
  ["PONDASI", 0.15, 0.5],
  ["SHELTER PENDARATAN", 0.22, 0.78],
  ["GUDANG BEKU", 0.25, 0.8],
  ["PABRIK ES", 0.3, 0.82],
  ["COOL BOX", 0.3, 0.82],
  ["BENGKEL", 0.3, 0.85],
  ["BALAI NELAYAN", 0.35, 0.85],
  ["KIOS PERBEKALAN", 0.35, 0.85],
  ["SENTRA KULINER", 0.35, 0.85],
  ["PEMASARAN IKAN", 0.35, 0.85],
  ["KANTOR PENGELOLA", 0.35, 0.88],
  ["SHELTER", 0.3, 0.85],
  ["AREA PARKIR", 0.45, 0.85],
  ["JALAN", 0.4, 0.9],
  ["SALURAN", 0.4, 0.9],
  ["PLUMBING", 0.45, 0.92],
  ["IPAL", 0.5, 0.9],
  ["TPS", 0.55, 0.92],
  ["GENSET", 0.6, 0.92],
  ["PENERANGAN", 0.55, 0.95],
  ["PAGAR", 0.35, 0.9],
  ["GERBANG", 0.55, 0.95],
  ["GAPURA", 0.75, 1.0],
  ["POS JAGA", 0.7, 0.95],
  ["TOILET", 0.6, 0.95],
  ["MUSHOLLA", 0.65, 0.95],
  ["GAZEBO", 0.7, 0.95],
  ["LANDSKAPING", 0.72, 1.0],
];

function getCategoryPhase(name: string): [number, number] {
  const upper = name.toUpperCase();
  for (const [kw, start, end] of CATEGORY_PHASE) {
    if (upper.includes(kw)) return [start, end];
  }
  return [0.25, 0.8];
}

function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 3 * t * t - 2 * t * t * t;
}

export interface RabInputCategory {
  roman: string;
  name: string;
  total_value: number;
  subcategories: Array<{
    total_value: number;
    items: Array<{
      volume: number | null;
      unit: string | null;
      unit_price: number | null;
      total_price: number | null;
      code: string;
      name: string;
    }>;
  }>;
  direct_items: Array<{
    volume: number | null;
    unit: string | null;
    unit_price: number | null;
    total_price: number | null;
    code: string;
    name: string;
  }>;
}

export interface RabInput {
  categories: RabInputCategory[];
}

export interface CategoryTimeline {
  roman: string;
  name: string;
  value: number;
  weightPct: number;
  weekStart: number;
  weekEnd: number;
  weeklyDeltaPct: number[];
}

export interface ScurveResult {
  totalWeeks: number;
  contractDays: number;
  grandTotal: number;
  weeklyDeltaPct: number[];
  cumulativePct: number[];
  categoryTimelines: CategoryTimeline[];
}

export function generateScurve(
  rab: RabInput,
  contractDays: number = DEFAULT_CONTRACT_DAYS
): ScurveResult {
  const totalWeeks = Math.ceil(contractDays / 7);
  const grandTotal = rab.categories
    .filter((c) => c.total_value > 0)
    .reduce((sum, c) => sum + c.total_value, 0);

  const weeklyDelta = new Array(totalWeeks).fill(0);
  const categoryTimelines: CategoryTimeline[] = [];

  for (const cat of rab.categories) {
    if (cat.total_value <= 0) continue;

    const [phaseStartPct, phaseEndPct] = getCategoryPhase(cat.name);
    const weekStart = Math.floor(phaseStartPct * totalWeeks);
    const weekEnd = Math.max(weekStart + 1, Math.floor(phaseEndPct * totalWeeks));
    const duration = weekEnd - weekStart;
    const catWeightPct = (cat.total_value / grandTotal) * 100;

    const catWeeklyPcts: number[] = [];
    let prev = 0;
    for (let w = 0; w < duration; w++) {
      const tNow = (w + 1) / duration;
      const now = smoothstep(tNow);
      catWeeklyPcts.push(now - prev);
      prev = now;
    }

    categoryTimelines.push({
      roman: cat.roman,
      name: cat.name,
      value: cat.total_value,
      weightPct: catWeightPct,
      weekStart,
      weekEnd,
      weeklyDeltaPct: catWeeklyPcts.map((d) => d * catWeightPct),
    });

    for (let i = 0; i < catWeeklyPcts.length; i++) {
      const wk = weekStart + i;
      if (wk >= 0 && wk < totalWeeks) {
        weeklyDelta[wk] += catWeeklyPcts[i] * catWeightPct;
      }
    }
  }

  const cumulative: number[] = [];
  let running = 0;
  for (const w of weeklyDelta) {
    running += w;
    cumulative.push(Math.min(100, Math.round(running * 100) / 100));
  }

  return {
    totalWeeks,
    contractDays,
    grandTotal,
    weeklyDeltaPct: weeklyDelta.map((x) => Math.round(x * 1000) / 1000),
    cumulativePct: cumulative,
    categoryTimelines,
  };
}
