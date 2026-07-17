/**
 * Kurva-S rencana. Tabel fase kategori + trade (urutan dependensi lapangan) +
 * keyword klasifikasi dipertahankan dari kode lama (b6e77af).
 *
 * DECISIONS 052: pembentukan kurva diganti dari akumulasi delta smoothstep
 * per-minggu → EVALUASI KONTINU kumulatif pada t = minggu/totalWeeks. Efek:
 * kurva mulai dari 0 (bukan "agak naik" di minggu-1), berakhir 100, monotonik,
 * dan bentuk-S lebih rapi. Bobot tetap cost-weighted (amount/grand); jendela
 * waktu tetap dari trade/kategori. Lihat cumulativeFromSegments.
 */

export const DEFAULT_CONTRACT_DAYS = 150;

// Category name keyword → [phase_start_pct, phase_end_pct]
// First match wins. Urutan konstruksi standar KNMP.
export const CATEGORY_PHASE: ReadonlyArray<readonly [string, number, number]> = [
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

export function getCategoryPhase(name: string): [number, number] {
  const upper = name.toUpperCase();
  for (const [kw, start, end] of CATEGORY_PHASE) {
    if (upper.includes(kw)) return [start, end];
  }
  return [0.25, 0.8]; // default phase
}

/** Cubic smoothstep 3t² − 2t³ untuk bentuk S. */
export function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 3 * t * t - 2 * t * t * t;
}

/**
 * Kumulatif rencana dari kumpulan (bobot%, jendela [start,end] fraksi durasi),
 * DIEVALUASI KONTINU pada t = minggu/totalWeeks utk minggu 1..totalWeeks.
 *
 * Setiap segmen naik smoothstep 0→bobot di dalam jendelanya (0 di start, penuh
 * di end). Kumulatif total = Σ segmen. Sifat yang DIJAMIN:
 *   - pada t=0 (awal proyek) = 0  → kurva mulai dari 0 (bukan "agak naik").
 *   - pada t=1 (akhir)       = Σ bobot = 100.
 *   - monotonik naik + bentuk-S alami (start landai, tengah curam, akhir landai).
 * Return: pct kumulatif akhir-minggu utk minggu 1..totalWeeks (panjang totalWeeks).
 */
function cumulativeFromSegments(
  segments: { weightPct: number; start: number; end: number }[],
  totalWeeks: number,
): number[] {
  const out: number[] = [];
  for (let week = 1; week <= totalWeeks; week++) {
    const t = week / totalWeeks;
    let acc = 0;
    for (const seg of segments) {
      const span = Math.max(1e-9, seg.end - seg.start);
      acc += seg.weightPct * smoothstep((t - seg.start) / span);
    }
    out.push(Math.min(100, Math.round(acc * 100) / 100));
  }
  return out;
}

/**
 * Kurva-S per kategori: map nama kategori → jendela fase, evaluasi kontinu.
 * Return: weekly cumulative pct (minggu 1..totalWeeks).
 */
export function generateScurve(
  categories: { name: string; totalValue: bigint }[],
  contractDays: number = DEFAULT_CONTRACT_DAYS,
): number[] {
  const totalWeeks = Math.max(1, Math.ceil(contractDays / 7));
  const grandTotal = categories
    .filter((c) => c.totalValue > 0n)
    .reduce((sum, c) => sum + Number(c.totalValue), 0);
  if (grandTotal <= 0) return new Array(totalWeeks).fill(0);

  const segments = categories
    .filter((c) => c.totalValue > 0n)
    .map((c) => {
      const [start, end] = getCategoryPhase(c.name);
      return { weightPct: (Number(c.totalValue) / grandTotal) * 100, start, end };
    });
  return cumulativeFromSegments(segments, totalWeeks);
}

// ── Penjadwalan per item berbasis "trade" (jenis pekerjaan) ─────────────────
// Urutan jendela = dependensi riil: persiapan → tanah → pondasi → struktur →
// dinding/atap → MEP → finishing → sarana luar → landscape.
// Taksonomi & kata kunci dari analisis 7 RAB KNMP nyata (≈11.800 item).

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

// Kata kunci per trade — dicek berurutan (nama item dulu, lalu nama kategori).
const KEYWORDS: ReadonlyArray<readonly [TradeKey, readonly string[]]> = [
  // Kalibrasi korpus RAB (docs/rab-analysis): peralatan mob & K3 → persiapan.
  ["persiapan", ["BOUWPLANK", "UITZET", "BEDENG", "DIREKSI", "SOSIALISASI", "INDUKSI", "RAMBU", "ASURANSI", "BPJS", "MOBILISASI", "PAPAN NAMA", "K3", "APD", "SEPATU", "ROMPI", "HELM", "SARUNG", "PEMBERSIHAN", "BONGKAR", "PENGUKURAN", "SETTING", "BULLDOZER", "EXCAVATOR", "CONCRETE MIXER", "MESIN LAS", "STAMPER", "ROLLER VIBRATOR", "P3K", "APAR", "EVAKUASI", "ESCAPE", "IJIN KERJA", "IZIN KERJA"]],
  ["tanah", ["GALIAN", "URUGAN", "URUG", "PEMADATAN", "TIMBUNAN", "CERUCUK", "DOLKEN", "LEVELLING", "LEVELING", "TANAH", "PADAT"]],
  ["pondasi", ["PONDASI", "FOOTPLAT", "FOOT PLAT", "TAPAK", "STROUS", "BOR PILE", "ANSTAMPING", "AANSTAMPING", "BATU KALI", "ROLLAG"]],
  ["struktur", ["BETON", "PEMBESIAN", "BEKESTING", "BEKISTING", "SLOOF", "KOLOM", "BALOK", "RINGBALK", "RING BALK", "PLATE", "VIBRATOR", "READYMIX", "READY MIX", "BESI", "WIREMESH", "WIRE MESH", "DYNABOLT", "WATERSTOP", "ROD COUPLING", "SKONENGAN", "ANGKUR", "ANGKER", "ANCHOR"]],
  ["atap", ["ATAP", "RANGKA", "KUDA", "GORDING", "BAJA RINGAN", "SPANDEK", "LISTPLANK", "LISPLANK", "TALANG", "PLAFOND", "PLAFON"]],
  ["dinding", ["DINDING", "BATA", "BATAKO", "PASANGAN", "PLESTERAN", "ACIAN", "HOLLOW", "ROSTER", "PARTISI"]],
  ["mep", ["PIPA", "PLUMBING", "INSTALASI", "LISTRIK", "KABEL", "PANEL", "STOP KONTAK", "SAKLAR", "LAMPU", "PENERANGAN", "IPAL", "POMPA", "SUMUR", "SANITAIR", "KLOSET", "WASTAFEL", "SEPTIC", "BIOTECH", "ARMATUR", "GENSET", "MCB", "AMPERE", "KVA", "DOWNLIGHT", "CLOSET", "TOREN", "TANDON", "AC SPLIT", "EXHAUST", "FLOOR DRAIN", "KRAN", "KERAN", "GROUNDING", "PJU", "WATER HEATER", "URINOIR", "URINAL"]],
  ["finishing", ["KERAMIK", "GRANIT", "LANTAI", "KUSEN", "PINTU", "JENDELA", "CASEMENT", "KACA", "PENGECATAN", "DUCO", "FINISH", "WATERPROOF", "RAILING", "HANDLE", "KUNCI", "CAT", "HARDENER"]],
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

/**
 * Jadwalkan item leaf → kurva-S kumulatif mingguan (%), minggu 1..totalWeeks.
 * Bobot per item = amount ÷ grand total; jendela waktu (fraksi durasi) dari
 * trade item (urutan dependensi lapangan). Evaluasi kontinu → mulai 0, akhir 100,
 * bentuk-S rapi (lihat cumulativeFromSegments).
 */
export function scheduleItems(
  items: { name: string; categoryName: string; amount: bigint }[],
  contractDays: number = DEFAULT_CONTRACT_DAYS,
): number[] {
  const n = Math.max(1, Math.ceil(contractDays / 7));
  const grand = items.reduce((s, it) => s + (it.amount > 0n ? Number(it.amount) : 0), 0);
  if (grand <= 0) return new Array(n).fill(0);

  const segments = items
    .filter((it) => it.amount > 0n)
    .map((it) => {
      const def = TRADE_BY_KEY.get(classifyTrade(it.name, it.categoryName))!;
      return { weightPct: (Number(it.amount) / grand) * 100, start: def.start, end: def.end };
    });
  return cumulativeFromSegments(segments, n);
}

/**
 * Fraksi rencana selesai (0..1) untuk SATU trade pada akhir minggu tertentu.
 * Dipakai saran rencana mingguan: berapa yang seharusnya sudah selesai per item.
 */
export function tradePlannedFraction(trade: TradeKey, weekNumber: number, totalWeeks: number): number {
  const def = TRADE_BY_KEY.get(trade)!;
  const t = Math.max(0, Math.min(1, weekNumber / Math.max(1, totalWeeks)));
  const span = Math.max(1e-9, def.end - def.start);
  return smoothstep((t - def.start) / span);
}

/**
 * Fraksi rencana selesai (0..1) untuk SATU KATEGORI (jendela fase kategori) pada
 * akhir minggu tertentu. Dipakai sheet Kurva-S KKP untuk sebar bobot kategori
 * per minggu (increment = bobot × [frac(w) − frac(w−1)]).
 */
export function categoryPlannedFraction(name: string, weekNumber: number, totalWeeks: number): number {
  const [start, end] = getCategoryPhase(name);
  const t = Math.max(0, Math.min(1, weekNumber / Math.max(1, totalWeeks)));
  const span = Math.max(1e-9, end - start);
  return smoothstep((t - start) / span);
}
