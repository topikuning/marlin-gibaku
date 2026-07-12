/**
 * Penjadwalan berbasis PEMBOBOTAN PER ITEM + urutan dependensi konstruksi.
 *
 * Tiap item RAB:
 *   1. dibobot by nilai (total_price ÷ grand total),
 *   2. diklasifikasi ke "trade" (jenis pekerjaan) via kata kunci nama item
 *      (fallback ke nama kategori),
 *   3. ditempatkan pada jendela waktu trade tsb — urutan jendela mencerminkan
 *      dependensi riil: persiapan → tanah → pondasi → struktur → dinding/atap →
 *      MEP → finishing → sarana luar → landscape.
 * Distribusi dalam jendela pakai smoothstep (bentuk-S per trade).
 *
 * Taksonomi & kata kunci diturunkan dari analisis 7 RAB KNMP nyata
 * (≈11.800 item; cakupan klasifikasi ≈97%). DECISIONS 028.
 */

export type TradeKey =
  | "persiapan"
  | "tanah"
  | "pondasi"
  | "struktur"
  | "dinding"
  | "atap"
  | "mep"
  | "finishing"
  | "sarana_luar"
  | "landscape"
  | "lainnya";

type TradeDef = { key: TradeKey; label: string; start: number; end: number };

// Urutan = dependensi. [start,end] = fraksi durasi kontrak.
export const TRADES: readonly TradeDef[] = [
  { key: "persiapan", label: "Persiapan & K3", start: 0.0, end: 0.12 },
  { key: "tanah", label: "Pekerjaan tanah", start: 0.05, end: 0.28 },
  { key: "pondasi", label: "Pondasi", start: 0.15, end: 0.45 },
  { key: "struktur", label: "Struktur beton", start: 0.25, end: 0.62 },
  { key: "dinding", label: "Dinding & plester", start: 0.42, end: 0.72 },
  { key: "atap", label: "Atap & plafond", start: 0.5, end: 0.75 },
  { key: "mep", label: "MEP (listrik/pipa)", start: 0.58, end: 0.88 },
  { key: "finishing", label: "Finishing arsitektur", start: 0.68, end: 0.96 },
  { key: "sarana_luar", label: "Sarana luar (jalan/pagar)", start: 0.3, end: 0.85 },
  { key: "landscape", label: "Landscape", start: 0.85, end: 1.0 },
  { key: "lainnya", label: "Lainnya", start: 0.25, end: 0.8 },
];

const TRADE_BY_KEY = new Map(TRADES.map((t) => [t.key, t]));
export function tradeLabel(key: TradeKey): string {
  return TRADE_BY_KEY.get(key)?.label ?? key;
}

// Kata kunci per trade — dicek berurutan (item-name dulu, lalu nama kategori).
const KEYWORDS: ReadonlyArray<readonly [TradeKey, readonly string[]]> = [
  ["persiapan", ["BOUWPLANK", "UITZET", "BEDENG", "DIREKSI", "SOSIALISASI", "INDUKSI", "RAMBU", "ASURANSI", "BPJS", "MOBILISASI", "PAPAN NAMA", "K3", "APD", "SEPATU", "ROMPI", "HELM", "SARUNG", "PEMBERSIHAN", "BONGKAR", "PENGUKURAN", "SETTING"]],
  ["tanah", ["GALIAN", "URUGAN", "URUG", "PEMADATAN", "TIMBUNAN", "CERUCUK", "DOLKEN", "LEVELLING", "LEVELING", "TANAH", "PADAT"]],
  ["pondasi", ["PONDASI", "FOOTPLAT", "FOOT PLAT", "TAPAK", "STROUS", "BOR PILE", "ANSTAMPING", "AANSTAMPING", "BATU KALI", "ROLLAG"]],
  ["struktur", ["BETON", "PEMBESIAN", "BEKESTING", "BEKISTING", "SLOOF", "KOLOM", "BALOK", "RINGBALK", "RING BALK", "PLATE", "VIBRATOR", "READYMIX", "READY MIX", "BESI"]],
  ["atap", ["ATAP", "RANGKA", "KUDA", "GORDING", "BAJA RINGAN", "SPANDEK", "LISTPLANK", "LISPLANK", "TALANG", "PLAFOND", "PLAFON"]],
  ["dinding", ["DINDING", "BATA", "BATAKO", "PASANGAN", "PLESTERAN", "ACIAN", "HOLLOW", "ROSTER", "PARTISI"]],
  ["mep", ["PIPA", "PLUMBING", "INSTALASI", "LISTRIK", "KABEL", "PANEL", "STOP KONTAK", "SAKLAR", "LAMPU", "PENERANGAN", "IPAL", "POMPA", "SUMUR", "SANITAIR", "KLOSET", "WASTAFEL", "SEPTIC", "BIOTECH", "ARMATUR", "GENSET"]],
  ["finishing", ["KERAMIK", "GRANIT", "LANTAI", "KUSEN", "PINTU", "JENDELA", "CASEMENT", "KACA", "PENGECATAN", "DUCO", "FINISH", "WATERPROOF", "RAILING", "HANDLE", "KUNCI", "CAT"]],
  ["sarana_luar", ["JALAN", "SALURAN", "DRAINASE", "GORONG", "PARKIR", "PAVING", "KANSTIN", "KANSTEEN", "PAGAR", "REVETMENT", "TAMBAT", "BRONJONG", "GEBALAN", "RABAT"]],
  ["landscape", ["PENANAMAN", "TANAMAN", "RUMPUT", "POHON", "TAMAN", "LANDSKAP", "LANSEKAP", "GAZEBO"]],
];

export function classifyTrade(itemName: string, categoryName: string): TradeKey {
  const n = (itemName || "").toUpperCase();
  for (const [trade, kws] of KEYWORDS) {
    for (const k of kws) if (n.includes(k)) return trade;
  }
  const c = (categoryName || "").toUpperCase();
  for (const [trade, kws] of KEYWORDS) {
    for (const k of kws) if (c.includes(k)) return trade;
  }
  return "lainnya";
}

function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 3 * t * t - 2 * t * t * t;
}

export type WorkItem = { name: string; categoryName: string; value: number };
export type WeekSuggestion = {
  week: number;
  trades: { key: TradeKey; label: string; pct: number }[];
};
export type ScheduleResult = {
  totalWeeks: number;
  cumulativePct: number[];
  weekly: WeekSuggestion[];
  tradeShares: { key: TradeKey; label: string; pct: number }[];
  classifiedPct: number; // % nilai yang bukan 'lainnya'
};

/**
 * Jadwalkan item → kurva-S kumulatif + saran pekerjaan per minggu.
 */
export function scheduleItems(items: WorkItem[], totalWeeks: number): ScheduleResult {
  const n = Math.max(1, totalWeeks);
  const grand = items.reduce((s, it) => s + (it.value > 0 ? it.value : 0), 0);
  const weeklyDelta = new Array(n).fill(0);
  const tradeWeek: Map<number, Map<TradeKey, number>> = new Map();
  const tradeTotal: Map<TradeKey, number> = new Map();

  if (grand <= 0) {
    return { totalWeeks: n, cumulativePct: new Array(n).fill(0), weekly: [], tradeShares: [], classifiedPct: 0 };
  }

  for (const it of items) {
    if (!(it.value > 0)) continue;
    const trade = classifyTrade(it.name, it.categoryName);
    const def = TRADE_BY_KEY.get(trade)!;
    const ws = Math.floor(def.start * n);
    const we = Math.max(ws + 1, Math.floor(def.end * n));
    const dur = we - ws;
    const weightPct = (it.value / grand) * 100;
    tradeTotal.set(trade, (tradeTotal.get(trade) ?? 0) + weightPct);

    let prev = 0;
    for (let i = 0; i < dur; i++) {
      const now = smoothstep((i + 1) / dur);
      const delta = (now - prev) * weightPct;
      prev = now;
      const wk = ws + i;
      if (wk >= 0 && wk < n) {
        weeklyDelta[wk] += delta;
        const tw = tradeWeek.get(wk) ?? new Map<TradeKey, number>();
        tw.set(trade, (tw.get(trade) ?? 0) + delta);
        tradeWeek.set(wk, tw);
      }
    }
  }

  const cumulativePct: number[] = [];
  let running = 0;
  for (const d of weeklyDelta) {
    running += d;
    cumulativePct.push(Math.min(100, Math.round(running * 100) / 100));
  }

  const weekly: WeekSuggestion[] = [];
  for (let w = 0; w < n; w++) {
    const tw = tradeWeek.get(w);
    if (!tw) continue;
    const trades = [...tw.entries()]
      .filter(([, pct]) => pct >= 0.05)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([key, pct]) => ({ key, label: tradeLabel(key), pct: Math.round(pct * 10) / 10 }));
    if (trades.length) weekly.push({ week: w + 1, trades });
  }

  const tradeShares = [...tradeTotal.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, pct]) => ({ key, label: tradeLabel(key), pct: Math.round(pct * 10) / 10 }));
  const classifiedPct = 100 - (tradeTotal.get("lainnya") ?? 0);

  return { totalWeeks: n, cumulativePct, weekly, tradeShares, classifiedPct: Math.round(classifiedPct * 10) / 10 };
}
