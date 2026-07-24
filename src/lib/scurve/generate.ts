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

// Category name keyword → [start_pct, end_pct] jendela presedensi (fraksi durasi).
// First match wins → keyword SPESIFIK sebelum yang umum.
//
// KALIBRASI (DECISIONS 079, disinkronkan DECISIONS 080): jendela presedensi
// antar-KATEGORI (bukan tahap absolut per-item). Pola inti: persiapan/tanah AWAL
// → revetment/penahan → bangunan TENGAH → jalan → penerangan/genset/IPAL AKHIR →
// landskap PALING AKHIR. "Penerangan kawasan" di ujung (bukan minggu-1): site &
// jalan harus jadi dulu.
//
// SUMBER (divalidasi 2026-07, bukan hanya 3 jadwal sipil KNMP):
//   - Metode kurva-S (bobot=biaya/total; batang=durasi; akumulasi %/waktu) =
//     praktik baku Indonesia, dipakai Kementerian PUPR. Ini persis model
//     BaselineScheduleItem → curveFromCategorySchedule.
//   - Sekuens site-development internasional: clearing/rough grading → utilitas
//     bawah tanah → finish grading → paving → LANDSCAPING & LIGHTING (site
//     amenities) terakhir. Sekuens gedung ID: persiapan → pondasi → struktur →
//     arsitektur/finishing → MEP.
// Angka % jendela = kalibrasi dari jadwal nyata (tak ada standar tertulis yang
// memberi persentase pasti); disempurnakan per-lokasi lewat editor manual.
export const CATEGORY_PHASE: ReadonlyArray<readonly [string, number, number]> = [
  ["PERSIAPAN", 0.0, 0.28],
  ["LEVELLING", 0.05, 0.28],
  ["REVETMENT", 0.12, 0.42],
  ["DINDING PENAHAN", 0.2, 0.48],
  ["TAMBATAN", 0.2, 0.58],
  ["DOCKING", 0.7, 0.95],
  ["PONDASI", 0.32, 0.55],
  ["SHELTER PENDARATAN", 0.32, 0.6],
  ["GUDANG BEKU", 0.38, 0.64],
  ["PABRIK ES", 0.38, 0.62],
  ["COOL BOX", 0.45, 0.68],
  ["BENGKEL", 0.45, 0.7],
  ["BALAI NELAYAN", 0.45, 0.72],
  ["KIOS PERBEKALAN", 0.45, 0.7],
  ["SENTRA KULINER", 0.45, 0.72],
  ["PEMASARAN IKAN", 0.45, 0.72],
  ["KANTOR PENGELOLA", 0.5, 0.72],
  ["TANGKI AIR", 0.52, 0.75],
  ["TANDON", 0.52, 0.75],
  ["SHELTER", 0.35, 0.65],
  ["AREA PARKIR", 0.45, 0.68],
  ["SUMUR BOR", 0.45, 0.72],
  ["PLUMBING", 0.52, 0.78],
  ["JALAN", 0.55, 0.9],
  ["SALURAN", 0.55, 0.9],
  ["IPAL", 0.78, 0.95],
  ["TPS", 0.78, 0.95],
  ["GENSET", 0.72, 0.92],
  ["PENERANGAN", 0.72, 1.0],
  ["PAGAR", 0.55, 0.9],
  ["GAPURA", 0.8, 1.0],
  ["GERBANG", 0.8, 1.0],
  ["POS JAGA", 0.65, 0.92],
  ["TOILET", 0.55, 0.88],
  ["MUSHOLLA", 0.6, 0.9],
  ["GAZEBO", 0.75, 0.98],
  ["LANDSKAP", 0.82, 1.0],
  ["LANDSCAP", 0.82, 1.0],
  ["LANSEKAP", 0.82, 1.0],
];

export function getCategoryPhase(name: string): [number, number] {
  const upper = name.toUpperCase();
  for (const [kw, start, end] of CATEGORY_PHASE) {
    if (upper.includes(kw)) return [start, end];
  }
  return [0.35, 0.75]; // default: pekerjaan tengah
}

/** Baris jadwal per kategori (bobot + jendela minggu) — sumber tunggal baseline. */
export type CategorySchedule = {
  lineageKey: string;
  name: string;
  weightPct: number;
  startWeek: number;
  endWeek: number;
};

/**
 * Jadwal per-KATEGORI otomatis dari presedensi (getCategoryPhase) — bukan tahap
 * absolut per-item. Bobot kategori = amount ÷ grand × 100; jendela [start,end]
 * dari tabel presedensi dikonversi ke minggu. Ini yang disimpan sebagai
 * BaselineScheduleItem (sumber tunggal: grafik, tabel KKP, deviasi ikut). DECISIONS 079.
 */
export function autoCategorySchedule(
  categories: { lineageKey: string; name: string; amount: bigint }[],
  totalWeeks: number,
): CategorySchedule[] {
  const n = Math.max(1, Math.floor(totalWeeks));
  const positive = categories.filter((c) => c.amount > 0n);
  const grand = positive.reduce((s, c) => s + Number(c.amount), 0);
  if (grand <= 0) return [];
  return positive.map((c) => {
    const [sf, ef] = getCategoryPhase(c.name);
    const startWeek = Math.max(1, Math.min(n, Math.floor(sf * n) + 1));
    const endWeek = Math.max(startWeek, Math.min(n, Math.ceil(ef * n)));
    return {
      lineageKey: c.lineageKey,
      name: c.name,
      weightPct: (Number(c.amount) / grand) * 100,
      startWeek,
      endWeek,
    };
  });
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
export function cumulativeFromSegments(
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
// Urutan = dependensi riil lapangan (CPM sequencing): persiapan → tanah →
// pondasi → struktur → dinding/atap → MEP → finishing → sarana luar → landscape.
// Taksonomi & kata kunci dari analisis 15 RAB KNMP nyata (docs/rab-analysis,
// ≈24.000 item, Rp 129 M, 3 provinsi).
//
// ── ALGORITMA JADWAL (DECISIONS 057) ──────────────────────────────────────
// Bobot biaya sudah per-lokasi (amount ÷ grand). Yang di-"AI"-kan di sini
// adalah PENJADWALAN-nya: kapan tiap trade mulai & selesai. Alih-alih jendela
// waktu tetap (dulu di-tebak pakar, sama utk semua lokasi), jendela dihitung
// PER-LOKASI dari komposisi bobotnya sendiri:
//
//   1. PRESEDENSI (CPM) — tiap trade punya "band" [bandStart,bandEnd] = amplop
//      paling awal boleh mulai … paling akhir boleh selesai. Ini mengunci urutan
//      lapangan (pondasi tak boleh mulai sebelum tanah, dst.) dengan tumpang-
//      tindih realistis (start-to-start lag), bukan finish-to-start kaku.
//   2. DURASI BERBASIS BIAYA (cost-based duration) — trade yang menyerap porsi
//      biaya lebih besar menempati rentang waktu lebih panjang. Ini prinsip
//      "cost-loaded schedule": durasi aktivitas ~ konten biaya/sumber dayanya.
//      Referensi: CMU PMbook (Construction Planning), praktik kurva-S RAB ID
//      (bobot = biaya/total; sebar bobot sepanjang durasi item).
//   3. POSISI dalam band via ANCHOR — front (mulai dari awal band: mobilisasi,
//      tanah, pondasi), tail (selesai di akhir band: finishing, landscape),
//      center (mengambang di tengah band: struktur, dinding, atap, mep).
//
// Efek: lokasi struktur-berat → jendela struktur melebar (kurva curam di
// tengah); lokasi MEP-berat → jendela MEP melebar. Kurva-S menyesuaikan diri
// tanpa panggil AI saat runtime — deterministik & bisa diuji.

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

export type TradeWindow = { start: number; end: number };

type Anchor = "front" | "center" | "tail";
type TradeBand = {
  key: TradeKey;
  label: string;
  /** Amplop presedensi: paling awal boleh mulai … paling akhir boleh selesai. */
  bandStart: number;
  bandEnd: number;
  /** Jangkar posisi jendela di dalam band. */
  anchor: Anchor;
  /** Durasi minimum (fraksi durasi kontrak) walau bobot kecil. */
  minDur: number;
};

// Urutan array = urutan dependensi lapangan. Band & anchor dikalibrasi dari
// urutan konstruksi gedung standar + korpus 15 RAB KNMP.
export const TRADE_BANDS: readonly TradeBand[] = [
  { key: "persiapan", label: "Persiapan & K3", bandStart: 0.0, bandEnd: 0.28, anchor: "front", minDur: 0.1 },
  { key: "tanah", label: "Pekerjaan tanah", bandStart: 0.03, bandEnd: 0.33, anchor: "front", minDur: 0.1 },
  { key: "pondasi", label: "Pondasi", bandStart: 0.08, bandEnd: 0.48, anchor: "front", minDur: 0.1 },
  { key: "struktur", label: "Struktur beton", bandStart: 0.16, bandEnd: 0.68, anchor: "center", minDur: 0.2 },
  { key: "dinding", label: "Dinding & plester", bandStart: 0.36, bandEnd: 0.78, anchor: "center", minDur: 0.12 },
  { key: "atap", label: "Atap & plafond", bandStart: 0.44, bandEnd: 0.8, anchor: "center", minDur: 0.1 },
  { key: "mep", label: "MEP (listrik/pipa)", bandStart: 0.34, bandEnd: 0.94, anchor: "center", minDur: 0.18 },
  // Finishing = ekor panjang alami kurva-S (overlap ekor struktur/dinding → akhir).
  // minDur besar supaya mulai lebih awal & tak ada jeda datar setelah struktur.
  { key: "finishing", label: "Finishing arsitektur", bandStart: 0.55, bandEnd: 1.0, anchor: "tail", minDur: 0.3 },
  { key: "sarana_luar", label: "Sarana luar (jalan/pagar)", bandStart: 0.28, bandEnd: 0.92, anchor: "center", minDur: 0.14 },
  { key: "landscape", label: "Landscape", bandStart: 0.78, bandEnd: 1.0, anchor: "tail", minDur: 0.08 },
  { key: "lainnya", label: "Lainnya", bandStart: 0.2, bandEnd: 0.86, anchor: "center", minDur: 0.14 },
];

const BAND_BY_KEY = new Map(TRADE_BANDS.map((b) => [b.key, b]));
export function tradeLabel(key: TradeKey): string {
  return BAND_BY_KEY.get(key)?.label ?? key;
}

/**
 * Porsi bobot (0..1) saat sebuah trade menempati SELURUH band-nya. Trade dgn
 * porsi ≥ ini memakai lebar band penuh; di bawahnya durasi mengecil linear
 * hingga minDur. ~0.32 dari korpus: struktur (≈0.37) mengisi penuh, trade
 * menengah (mep/tanah ≈0.11) mengisi ±sepertiga band.
 */
const DURATION_REF = 0.32;

/**
 * Komposisi bobot "tipikal" KNMP dari korpus 15 RAB (share nilai). Dipakai
 * sebagai jendela default saat konteks bobot lokasi tak tersedia (mis. saran
 * mingguan sebelum ada item). Bukan angka ajaib — hanya titik awal realistis.
 */
export const TYPICAL_TRADE_MIX: Readonly<Record<TradeKey, number>> = {
  struktur: 0.374,
  tanah: 0.118,
  mep: 0.111,
  persiapan: 0.087,
  atap: 0.086,
  dinding: 0.076,
  pondasi: 0.053,
  sarana_luar: 0.047,
  finishing: 0.042,
  landscape: 0.005,
  lainnya: 0.002,
};

/**
 * ALGORITMA JADWAL: bobot per-trade (share nilai) → jendela [start,end] tiap
 * trade. Durasi ∝ bobot (cost-based duration), diposisikan dalam band
 * presedensi lewat anchor. Deterministik; lihat blok komentar DECISIONS 057.
 */
export function computeTradeWindows(
  weightByTrade: Partial<Record<TradeKey, number>>,
): Record<TradeKey, TradeWindow> {
  const total = Object.values(weightByTrade).reduce((s, w) => s + (w && w > 0 ? w : 0), 0);
  const out = {} as Record<TradeKey, TradeWindow>;
  for (const b of TRADE_BANDS) {
    const share = total > 0 ? Math.max(0, weightByTrade[b.key] ?? 0) / total : 0;
    const bandWidth = b.bandEnd - b.bandStart;
    const f = Math.min(1, share / DURATION_REF); // 0..1
    const dur = Math.min(bandWidth, b.minDur + (bandWidth - b.minDur) * f);
    let start: number;
    if (b.anchor === "front") start = b.bandStart;
    else if (b.anchor === "tail") start = b.bandEnd - dur;
    else start = (b.bandStart + b.bandEnd) / 2 - dur / 2; // center
    // Jaga tetap di dalam band (numerik).
    start = Math.max(b.bandStart, Math.min(start, b.bandEnd - dur));
    out[b.key] = { start, end: start + dur };
  }
  return out;
}

/** Jendela default (memakai komposisi tipikal KNMP). */
export const DEFAULT_TRADE_WINDOWS = computeTradeWindows(TYPICAL_TRADE_MIX);

/** Akumulasi share bobot per-trade dari daftar item leaf (amount ≥ 0). */
export function tradeWeights(
  items: { name: string; categoryName: string; amount: bigint }[],
): Record<TradeKey, number> {
  const acc = {} as Record<TradeKey, number>;
  for (const b of TRADE_BANDS) acc[b.key] = 0;
  for (const it of items) {
    if (it.amount > 0n) acc[classifyTrade(it.name, it.categoryName)] += Number(it.amount);
  }
  return acc;
}

// Kata kunci per trade — dicek berurutan (nama item dulu, lalu nama kategori).
const KEYWORDS: ReadonlyArray<readonly [TradeKey, readonly string[]]> = [
  // Kalibrasi korpus RAB (docs/rab-analysis): peralatan mob & K3 → persiapan.
  ["persiapan", ["BOUWPLANK", "UITZET", "BEDENG", "DIREKSI", "SOSIALISASI", "INDUKSI", "RAMBU", "ASURANSI", "BPJS", "MOBILISASI", "PAPAN NAMA", "K3", "APD", "SEPATU", "ROMPI", "HELM", "SARUNG", "PEMBERSIHAN", "BONGKAR", "PENGUKURAN", "SETTING", "BULLDOZER", "EXCAVATOR", "CONCRETE MIXER", "MESIN LAS", "STAMPER", "ROLLER VIBRATOR", "P3K", "APAR", "EVAKUASI", "ESCAPE", "IJIN KERJA", "IZIN KERJA", "MASKER", "KARTU IDENTITAS"]],
  ["tanah", ["GALIAN", "URUGAN", "URUG", "PEMADATAN", "TIMBUNAN", "CERUCUK", "DOLKEN", "LEVELLING", "LEVELING", "TANAH", "PADAT"]],
  ["pondasi", ["PONDASI", "FOOTPLAT", "FOOT PLAT", "TAPAK", "STROUS", "BOR PILE", "ANSTAMPING", "AANSTAMPING", "BATU KALI", "ROLLAG"]],
  ["struktur", ["BETON", "PEMBESIAN", "BEKESTING", "BEKISTING", "SLOOF", "KOLOM", "BALOK", "RINGBALK", "RING BALK", "PLATE", "VIBRATOR", "READYMIX", "READY MIX", "BESI", "WIREMESH", "WIRE MESH", "DYNABOLT", "WATERSTOP", "ROD COUPLING", "SKONENGAN", "ANGKUR", "ANGKER", "ANCHOR"]],
  ["atap", ["ATAP", "RANGKA", "KUDA", "GORDING", "BAJA RINGAN", "SPANDEK", "LISTPLANK", "LISPLANK", "TALANG", "PLAFOND", "PLAFON"]],
  ["dinding", ["DINDING", "BATA", "BATAKO", "PASANGAN", "PLESTERAN", "ACIAN", "HOLLOW", "ROSTER", "PARTISI"]],
  ["mep", ["PIPA", "PLUMBING", "INSTALASI", "LISTRIK", "KABEL", "PANEL", "STOP KONTAK", "SAKLAR", "LAMPU", "PENERANGAN", "IPAL", "POMPA", "SUMUR", "SANITAIR", "KLOSET", "WASTAFEL", "SEPTIC", "BIOTECH", "ARMATUR", "GENSET", "MCB", "AMPERE", "KVA", "DOWNLIGHT", "CLOSET", "TOREN", "TANDON", "AC SPLIT", "EXHAUST", "FLOOR DRAIN", "KRAN", "KERAN", "GROUNDING", "PJU", "WATER HEATER", "URINOIR", "URINAL", "JET WASHER"]],
  ["finishing", ["KERAMIK", "GRANIT", "LANTAI", "KUSEN", "PINTU", "JENDELA", "CASEMENT", "KACA", "PENGECATAN", "DUCO", "FINISH", "WATERPROOF", "RAILING", "HANDLE", "KUNCI", "CAT", "HARDENER", "DOOR CLOSER"]],
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

  // Jadwal PER-LOKASI: jendela trade dihitung dari komposisi bobot lokasi ini.
  const windows = computeTradeWindows(tradeWeights(items));
  const segments = items
    .filter((it) => it.amount > 0n)
    .map((it) => {
      const w = windows[classifyTrade(it.name, it.categoryName)];
      return { weightPct: (Number(it.amount) / grand) * 100, start: w.start, end: w.end };
    });
  return cumulativeFromSegments(segments, n);
}

// ── Kurva-S dari jadwal per pekerjaan (editor manual) ───────────────────────

export type CategoryScheduleRow = {
  /** Bobot pekerjaan % (nilai ÷ grand total × 100) — derived dari RAB, terkunci. */
  weightPct: number;
  /** Minggu mulai (1-based, inklusif). */
  startWeek: number;
  /** Minggu selesai (1-based, inklusif, ≥ startWeek). */
  endWeek: number;
};

/**
 * Kurva-S dari jadwal per pekerjaan — FORMAT STANDAR kurva-S sipil (barchart):
 * bobot tiap pekerjaan dibagi RATA per minggu di dalam jendela
 * [startWeek..endWeek], lalu diakumulasi vertikal per minggu → kumulatif.
 * (Praktik lapangan Indonesia: "bobot ÷ durasi" per periode; kurva-S agregat
 * mendapatkan bentuk S dari tumpang-tindih antar pekerjaan, bukan dari
 * distribusi per aktivitas.)
 *
 * Sifat: mulai 0 (sebelum minggu-1), akhir = Σ bobot (=100 bila lengkap),
 * monotonik naik. Jendela di luar rentang di-clamp ke [1..totalWeeks].
 */
export function curveFromCategorySchedule(
  rows: CategoryScheduleRow[],
  totalWeeks: number,
): number[] {
  const n = Math.max(1, Math.floor(totalWeeks));
  const weekly = new Array<number>(n).fill(0);
  for (const r of rows) {
    if (!(r.weightPct > 0)) continue;
    const s = Math.max(1, Math.min(n, Math.floor(r.startWeek)));
    const e = Math.max(s, Math.min(n, Math.floor(r.endWeek)));
    const perWeek = r.weightPct / (e - s + 1);
    for (let w = s; w <= e; w++) weekly[w - 1] += perWeek;
  }
  const out: number[] = [];
  let acc = 0;
  for (let w = 0; w < n; w++) {
    acc += weekly[w];
    out.push(Math.min(100, Math.round(acc * 100) / 100));
  }
  return out;
}

/**
 * Fraksi rencana selesai (0..1) untuk SATU trade pada akhir minggu tertentu.
 * Dipakai saran rencana mingguan: berapa yang seharusnya sudah selesai per item.
 */
export function tradePlannedFraction(
  trade: TradeKey,
  weekNumber: number,
  totalWeeks: number,
  windows: Record<TradeKey, TradeWindow> = DEFAULT_TRADE_WINDOWS,
): number {
  const w = windows[trade] ?? DEFAULT_TRADE_WINDOWS[trade];
  const t = Math.max(0, Math.min(1, weekNumber / Math.max(1, totalWeeks)));
  const span = Math.max(1e-9, w.end - w.start);
  return smoothstep((t - w.start) / span);
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
