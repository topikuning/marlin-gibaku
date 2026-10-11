import {
  autoCategoryWindowFrac,
  classifyStage,
  detectWorkType,
  fraksiJendela,
  HARD_EDGES,
  itemPlannedFraction,
  stageLabel,
  type StageKey,
  type WorkType,
} from "@/lib/scurve/sequencing";
import type { JadwalAiItem } from "./jadwal-ai-murni";

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
  /**
   * Bagian target yang mengejar ketertinggalan – rencana s/d minggu SEBELUM
   * minggu berjalan yang belum terealisasi. Rencana minggu lain yang belum
   * jatuh tempo tidak dihitung tertinggal.
   */
  catchUpVolume: number;
  priority: number;
  /** Nilai rupiah target (targetVolume × unitPrice). */
  valueTarget: number;
  reason: string;
  /** Urutan dari analisa AI atas RAB aktif (DECISIONS 667) atau aturan bawaan. */
  sumberUrutan: "ai" | "aturan";
  /** Alasan urutan dari AI – penjelasan, bukan angka. */
  alasanAi: string | null;
  kritis: boolean;
  pekaCuaca: boolean;
};

export type WeeklySuggestionResult = {
  weekNumber: number;
  totalWeeks: number;
  /** Minggu berjalan sejak SPMK; 0 = belum SPMK. */
  currentWeek: number;
  /** Rencana kumulatif % s/d akhir minggu berjalan (0 sebelum SPMK). */
  planPct: number;
  /** Rencana kumulatif % s/d akhir minggu yang DIRENCANAKAN. */
  targetPct: number;
  /** Realisasi kumulatif % (nilai) saat ini. */
  actualPct: number;
  /** actual − plan; negatif = tertinggal. */
  deviationPct: number;
  behind: boolean;
  suggestions: WeeklySuggestion[];
  /** Keadaan analisa AI urutan RAB aktif (DECISIONS 667); null = belum pernah. */
  jadwalAi?: {
    status: "antre" | "jalan" | "selesai" | "sebagian" | "gagal";
    model: string | null;
    galat: string | null;
    selesaiAt: string | null;
    bangunan: { total: number; selesai: number; gagal: number };
    /** Pekerjaan yang urutannya dari AI. */
    pekerjaan: number;
    catatan: { nama: string; catatan: string }[];
  } | null;
};

export type LeafInput = {
  rabNodeId: string;
  code: string;
  name: string;
  unit: string | null;
  /** Identitas kategori (lineageKey node kategori) — nama BUKAN kunci unik (CALC-04). */
  categoryKey?: string;
  categoryName: string;
  volume: number;
  unitPrice: number;
  lineageKey: string;
};

/** Estimasi berapa minggu sebuah item tertinggal (utk alasan yang informatif). */
function overdueWeeks(
  fraksi: (week: number) => number,
  volume: number,
  realized: number,
  weekNumber: number,
): number {
  for (let k = 0; k < weekNumber; k++) {
    const planned = fraksi(k) * volume;
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
  /** Jendela presedensi kategori (fraksi) — dari baseline tersimpan/manual; auto default. */
  categoryWindowFrac: (categoryName: string, categoryKey?: string) => [number, number] = autoCategoryWindowFrac,
  /**
   * Hasil analisa AI per lineageKey (DECISIONS 667). Pekerjaan yang ada di
   * sini memakai urutan & prasyarat dari AI di dalam jendela bangunannya;
   * selebihnya tetap aturan bawaan. Volume target tetap dihitung di sini.
   */
  jadwalAi: Map<string, JadwalAiItem> = new Map(),
  /**
   * Minggu berjalan. Yang disebut "tertinggal" hanya rencana s/d minggu
   * sebelum minggu berjalan; merencanakan minggu depan tidak membuat rencana
   * minggu ini tampak sebagai tunggakan. Bawaan = minggu yang direncanakan.
   */
  mingguBerjalan: number = weekNumber,
): WeeklySuggestion[] {
  const raw: (WeeklySuggestion & { rankScore: number })[] = [];

  // Tipe pekerjaan PER-UNIT (kategori) — dari mayoritas item unit itu. Unit
  // dikenali lewat KUNCI lineage; dua unit bernama sama tidak boleh dilebur.
  const keyOf = (it: LeafInput): string => it.categoryKey || it.categoryName;
  const namesByCat = new Map<string, string[]>();
  const nameOfCat = new Map<string, string>();
  for (const it of leaves) {
    const k = keyOf(it);
    const arr = namesByCat.get(k) ?? [];
    arr.push(it.name);
    namesByCat.set(k, arr);
    if (!nameOfCat.has(k)) nameOfCat.set(k, it.categoryName);
  }
  const typeByCat = new Map<string, WorkType>();
  for (const [k, names] of namesByCat) typeByCat.set(k, detectWorkType(nameOfCat.get(k) ?? "", names));

  // Tahap tiap item + rekap nilai rencana/realisasi per (unit, tahap) untuk
  // gerbang prasyarat.
  const stageOf = new Map<string, { workType: WorkType; stage: StageKey }>();
  const plannedByCatStage = new Map<string, number>(); // `${cat}|${stage}` → Σ nilai
  const realizedByCatStage = new Map<string, number>();
  for (const it of leaves) {
    if (!(it.volume > 0)) continue;
    const workType = typeByCat.get(keyOf(it)) ?? "gedung";
    const stage = classifyStage(workType, it.name, it.categoryName);
    stageOf.set(it.rabNodeId, { workType, stage });
    const key = `${keyOf(it)}|${stage}`;
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

  // Prasyarat dari AI: per pekerjaan, porsi volume yang sudah terealisasi.
  const porsiSelesai = new Map<string, number>();
  for (const it of leaves) {
    if (!(it.volume > 0)) continue;
    porsiSelesai.set(it.lineageKey, (realizedByLineage.get(it.lineageKey) ?? 0) / it.volume);
  }
  const prasyaratAiTertahan = (ai: JadwalAiItem): boolean =>
    ai.prasyarat.some((p) => porsiSelesai.has(p) && porsiSelesai.get(p)! < PREREQ_GATE);

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
    // Pekerjaan yang dianalisa AI memakai prasyarat AI-nya sendiri.
    const ai = jadwalAi.get(it.lineageKey);
    if (ai ? prasyaratAiTertahan(ai) : blockingPrereq(keyOf(it), workType, stage)) continue;

    const [cs, ce] = categoryWindowFrac(it.categoryName, it.categoryKey);
    const fraksi = ai
      ? (k: number) => fraksiJendela(cs + ai.mulai * (ce - cs), cs + ai.selesai * (ce - cs), k, totalWeeks)
      : (k: number) => itemPlannedFraction(workType, stage, cs, ce, k, totalWeeks);
    const fracNow = fraksi(weekNumber);
    const fracPrev = fraksi(weekNumber - 1);

    const incrementalThisWeek = Math.max(0, (fracNow - fracPrev) * it.volume);
    const plannedByLastWeek = fracPrev * it.volume;
    const shortfall = Math.max(0, plannedByLastWeek - realized);

    // Hanya sarankan item yang aktif minggu ini ATAU tertinggal (jendela mulai).
    if (incrementalThisWeek <= EPS && shortfall <= EPS) continue;

    const targetVolume = Math.min(remaining, incrementalThisWeek + shortfall);
    if (targetVolume <= EPS) continue;
    // Tertinggal = rencana yang SUDAH jatuh tempo (s/d minggu sebelum minggu berjalan).
    const batasTempo = Math.min(weekNumber, Math.max(0, mingguBerjalan)) - 1;
    const overdue = batasTempo >= 0 ? Math.max(0, fraksi(batasTempo) * it.volume - realized) : 0;
    const catchUpVolume = Math.min(overdue, targetVolume);
    const valueTarget = Math.round(targetVolume * it.unitPrice);

    let reason: string;
    if (overdue > EPS) {
      const wk = overdueWeeks(fraksi, it.volume, realized, batasTempo + 1);
      reason = wk > 0 ? `Tertinggal ~${wk} mgg – kejar` : "Tertinggal – kejar";
    } else if (shortfall > EPS) {
      reason = "Lanjutan rencana minggu sebelumnya";
    } else if (fracPrev <= EPS && fracNow > EPS) {
      reason = "Mulai minggu ini";
    } else {
      reason = "Sesuai jadwal";
    }

    // Pekerjaan kritis menurut AI didahulukan: telatnya menunda bangunan selesai.
    const rankScore = (valueTarget + catchUpVolume * it.unitPrice * 1.5) * (ai?.kritis ? 1.5 : 1);

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
      sumberUrutan: ai ? "ai" : "aturan",
      alasanAi: ai?.alasan || null,
      kritis: ai?.kritis ?? false,
      pekaCuaca: ai?.cuaca ?? false,
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
