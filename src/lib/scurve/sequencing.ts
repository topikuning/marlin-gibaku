/**
 * MESIN PENJADWALAN KONSTRUKSI (urutan tahapan real lapangan).
 *
 * Perbaikan atas keterbatasan penjadwalan lama (generate.ts) yang mengelompokkan
 * item per-"trade" SECARA GLOBAL selokasi — sehingga urutan antar-tahap dalam
 * SATU bangunan tak terjamin (mis. dinding rumah genset bisa "mulai" sebelum
 * pondasi rumah genset karena meminjam jendela pondasi global bangunan lain).
 *
 * Model baru — WBS berbasis UNIT:
 *   Lokasi → UNIT (kategori RAB = bangunan/ruas/struktur) → TAHAP → item.
 *   Tiap unit dideteksi TIPE PEKERJAANNYA (gedung/jalan/marine/utilitas/
 *   lansekap/umum), lalu tiap item ditempatkan pada TAHAP tipe itu dengan
 *   jendela waktu ber-PRESEDENSI (urutan lapangan). Antar-unit berjalan paralel;
 *   presedensi ditegakkan DI DALAM tiap unit.
 *
 * Sumber urutan: praktik konstruksi umum (bukan cuma Indonesia) —
 *   Gedung: tanah → pondasi → struktur → dinding → (MEP rough-in tertanam) →
 *           atap → plafond → finishing (plester→acian→lantai→kusen→cat) →
 *           MEP finishing (lampu/saklar/sanitair) → testing/commissioning.
 *   Jalan : badan jalan/subgrade → (drainase) → lapis pondasi agregat →
 *           perkerasan (aspal/rigid) → pelengkap → marka (paling akhir).
 *   Marine: galian/pancang/geotextile → struktur (poer/balok/armour) → deck/capping.
 *
 * Prinsip penting yang ditegakkan (diuji sebagai invarian):
 *   - MEP dipecah: rough-in (kabel/konduit/pipa TERTANAM) mendahului plester &
 *     terikat dinding; fixture (lampu/armatur/sanitair) di finishing PALING akhir
 *     setelah cat. ("pasang kabel" ≠ "pasang lampu".)
 *   - Tidak boleh pasang dinding sebelum pondasi (di dalam unit yang sama).
 *   - Jalan: marka & perlengkapan paling akhir; perkerasan setelah lapis pondasi.
 *
 * Semua deterministik & pure (tak sentuh DB) → bisa diuji terhadap korpus RAB.
 */

import { cumulativeFromSegments } from "./generate";

export type WorkType = "gedung" | "jalan" | "marine" | "utilitas" | "lansekap" | "umum";

export type StageKey =
  // umum / lintas
  | "persiapan"
  | "lainnya"
  // gedung
  | "tanah"
  | "pondasi"
  | "struktur"
  | "dinding"
  | "mep_roughin"
  | "atap"
  | "plafond"
  | "finishing"
  | "mep_finish"
  | "sanitair"
  | "testing"
  // jalan
  | "badan_jalan"
  | "drainase"
  | "lapis_pondasi"
  | "perkerasan"
  | "pelengkap_jalan"
  | "marka"
  // marine
  | "marine_sub"
  | "marine_struktur"
  | "marine_deck"
  // utilitas
  | "util_galian"
  | "util_pasang"
  | "util_finish"
  // lansekap
  | "lansekap";

export type StageDef = {
  key: StageKey;
  label: string;
  /** Jendela waktu di dalam unit (fraksi durasi, 0..1). */
  start: number;
  end: number;
};

/** Template tahapan + jendela (unit-normalized) per tipe pekerjaan. */
export const STAGE_TEMPLATES: Record<WorkType, StageDef[]> = {
  gedung: [
    { key: "persiapan", label: "Persiapan", start: 0.0, end: 0.1 },
    { key: "tanah", label: "Pekerjaan tanah", start: 0.04, end: 0.18 },
    { key: "pondasi", label: "Pondasi", start: 0.12, end: 0.32 },
    { key: "struktur", label: "Struktur beton", start: 0.26, end: 0.56 },
    { key: "dinding", label: "Dinding & pasangan", start: 0.46, end: 0.66 },
    { key: "mep_roughin", label: "MEP tanam (kabel/pipa)", start: 0.5, end: 0.68 },
    { key: "atap", label: "Atap", start: 0.58, end: 0.76 },
    { key: "plafond", label: "Plafond", start: 0.76, end: 0.86 },
    { key: "finishing", label: "Finishing (plester→cat)", start: 0.68, end: 0.9 },
    { key: "mep_finish", label: "MEP akhir (lampu/armatur)", start: 0.9, end: 1.0 },
    { key: "sanitair", label: "Sanitair & fixture", start: 0.9, end: 1.0 },
    { key: "testing", label: "Testing/commissioning", start: 0.95, end: 1.0 },
  ],
  jalan: [
    { key: "persiapan", label: "Persiapan", start: 0.0, end: 0.1 },
    { key: "badan_jalan", label: "Badan jalan/subgrade", start: 0.05, end: 0.35 },
    { key: "drainase", label: "Drainase/saluran", start: 0.15, end: 0.55 },
    { key: "lapis_pondasi", label: "Lapis pondasi agregat", start: 0.35, end: 0.62 },
    { key: "perkerasan", label: "Perkerasan (aspal/rigid)", start: 0.62, end: 0.86 },
    { key: "pelengkap_jalan", label: "Bahu/kanstin/pelengkap", start: 0.72, end: 0.92 },
    { key: "marka", label: "Marka & rambu", start: 0.9, end: 1.0 },
  ],
  marine: [
    { key: "persiapan", label: "Persiapan", start: 0.0, end: 0.1 },
    { key: "marine_sub", label: "Galian/pancang/filter", start: 0.06, end: 0.4 },
    { key: "marine_struktur", label: "Struktur (poer/armour)", start: 0.3, end: 0.72 },
    { key: "marine_deck", label: "Deck/capping/finishing", start: 0.72, end: 0.96 },
  ],
  utilitas: [
    { key: "persiapan", label: "Persiapan", start: 0.0, end: 0.1 },
    { key: "util_galian", label: "Galian/bor/pondasi", start: 0.08, end: 0.4 },
    { key: "util_pasang", label: "Pasang pipa/kabel/struktur", start: 0.3, end: 0.72 },
    { key: "util_finish", label: "Fixture/pompa/SLO", start: 0.72, end: 0.94 },
    { key: "testing", label: "Testing/commissioning", start: 0.92, end: 1.0 },
  ],
  lansekap: [
    { key: "persiapan", label: "Persiapan", start: 0.0, end: 0.15 },
    { key: "lansekap", label: "Landscape/penanaman", start: 0.7, end: 1.0 },
  ],
  umum: [
    { key: "persiapan", label: "Persiapan & K3", start: 0.0, end: 0.15 },
    { key: "tanah", label: "Levelling/tanah", start: 0.03, end: 0.25 },
    { key: "lainnya", label: "Lainnya", start: 0.2, end: 0.85 },
  ],
};

/** Jendela fallback (item tak terklasifikasi) per tipe — rentang tengah, low-risk. */
const FALLBACK_WINDOW: Record<WorkType, StageDef> = {
  gedung: { key: "lainnya", label: "Lainnya", start: 0.25, end: 0.8 },
  jalan: { key: "lainnya", label: "Lainnya", start: 0.2, end: 0.8 },
  marine: { key: "lainnya", label: "Lainnya", start: 0.2, end: 0.85 },
  utilitas: { key: "lainnya", label: "Lainnya", start: 0.25, end: 0.85 },
  lansekap: { key: "lainnya", label: "Lainnya", start: 0.4, end: 0.95 },
  umum: { key: "lainnya", label: "Lainnya", start: 0.2, end: 0.85 },
};

function stageDef(workType: WorkType, key: StageKey): StageDef {
  return STAGE_TEMPLATES[workType].find((s) => s.key === key) ?? FALLBACK_WINDOW[workType];
}

export function stageLabel(workType: WorkType, key: StageKey): string {
  return stageDef(workType, key).label;
}

// ── Deteksi TIPE UNIT dari nama kategori (= bangunan/ruas) ───────────────────
// Urutan cek penting: yang spesifik dulu. Bangunan (walau memuat genset/pabrik es/
// gudang beku) tetap GEDUNG karena punya struktur sipil (pondasi/dinding/atap);
// item MEP di dalamnya diklasifikasi ke tahap mep_* oleh classifyStage.
const WORKTYPE_BY_CATEGORY: ReadonlyArray<readonly [WorkType, readonly string[]]> = [
  ["jalan", ["JALAN", "AREA PARKIR", "PARKIR", "PAVING", "PERKERASAN", "RABAT BETON KAWASAN"]],
  ["marine", ["REVETMENT", "TAMBATAN", "DERMAGA", "DOCKING", "DECK ON PILE", "BREAKWATER", "TALUD", "TURAP", "DINDING PENAHAN", "PLENGSENGAN", "GROIN"]],
  ["lansekap", ["LANDSKAP", "LANSEKAP", "LANDSCAPE", "PENGHIJAUAN"]],
  // Bangunan/gedung — menang atas kata kunci utilitas bila memuat kata bangunan.
  ["gedung", ["BANGUNAN", "SHELTER", "KANTOR", "KIOS", "TOILET", "BALAI", "BENGKEL", "GUDANG", "PABRIK ES", "GENSET", "COOL BOX", "RUMAH", "POS JAGA", "GAPURA", "MUSHOLLA", "GAZEBO", "PONDASI"]],
  // Infrastruktur non-bangunan (tanpa kata bangunan).
  ["utilitas", ["PLUMBING", "PENERANGAN", "IPAL", "SUMUR BOR", "SUMUR", "TANGKI", "TPS", "PEMBUANGAN SAMPAH", "AIR BERSIH", "ELEKTRIKAL", "MEKANIKAL", "HIDRAN", "DISTRIBUSI"]],
  ["umum", ["PERSIAPAN", "LEVELLING", "LEVELING", "MOBILISASI", "SMKK", "UMUM"]],
];

/**
 * Tipe pekerjaan sebuah unit (kategori). Prioritas nama kategori; bila kategori
 * tak dikenal (mis. judul kosong), tebak dari mayoritas item → default gedung.
 */
export function detectWorkType(categoryName: string, itemNames: string[] = []): WorkType {
  const c = (categoryName || "").toUpperCase();
  for (const [type, kws] of WORKTYPE_BY_CATEGORY) {
    for (const k of kws) if (c.includes(k)) return type;
  }
  // Kategori tak berjudul → tebak dari item.
  const upper = itemNames.map((n) => (n || "").toUpperCase());
  const hasRe = (re: RegExp) => upper.some((n) => re.test(n));
  if (hasRe(/ASPAL|AGREGAT|LAPIS PONDASI|MARKA|PRIME COAT|PAVING|SUBGRADE/)) return "jalan";
  if (hasRe(/PANCANG|ARMOUR|GEOTEXTILE|REVETMENT|BRONJONG|DREDGING/)) return "marine";
  if (hasRe(/PIPA|POMPA|SUMUR BOR|PANEL|KWH|SLO|HIDRAN/) && !hasRe(/DINDING|KOLOM|ATAP/)) return "utilitas";
  return "gedung";
}

// ── Klasifikasi TAHAP item (per tipe) — kunci: pisah MEP tanam vs fixture ─────

// Rough-in KUAT: penanda pekerjaan tanam/kabel yang menang atas kata "LAMPU"
// (mis. "INSTALASI TITIK LAMPU" = tarik kabel titik, bukan pasang armatur).
const KW_MEP_ROUGHIN_STRONG = ["INSTALASI", "TITIK", "KONDUIT", "CONDUIT", "SPARING", "KABEL", "WIRING", "PENGKABELAN", "PENGABELAN", "PENGKABELAN"];
/** Kata kunci fixture MEP akhir (dipasang setelah cat). */
const KW_MEP_FINISH = ["LAMPU", "ARMATUR", "DOWNLIGHT", "SAKLAR", "SAKELAR", "STOP KONTAK", "STOPKONTAK", "FITTING", "PJU", "PENERANGAN", "EXHAUST", "AC SPLIT", "AC ", "KIPAS", "FAN"];
const KW_SANITAIR = ["KLOSET", "CLOSET", "WASTAFEL", "URINOIR", "URINAL", "KRAN", "KERAN", "JET WASHER", "FLOOR DRAIN", "SHOWER", "WATER HEATER", "SANITAIR", "SANITARY", "TANDON", "TOREN"];
const KW_MEP_ROUGHIN = ["KABEL", "KONDUIT", "CONDUIT", "INSTALASI", "PIPA", "SPARING", "GROUNDING", "ARDE", "PANEL", "MCB", "BOX PANEL", "TRAY KABEL", "PVC", "WIRING", "STEKER", "KABEL TRAY", "GRUNDING"];
const KW_TESTING = ["TESTING", "COMMISSIONING", "SLO", "NIDI", "PENDAFTARAN", "UJI ", "PENGUJIAN", "SERTIFIKAT LAIK"];

// Gedung — struktur & arsitektur.
const KW_PERSIAPAN = ["BEDENG", "DIREKSI", "PAPAN NAMA", "MOBILISASI", "DEMOBILISASI", "K3", "APD", "SAFETY", "HELM", "ROMPI", "SARUNG TANGAN", "SEPATU", "MASKER", "P3K", "APAR", "RAMBU", "INDUKSI", "SOSIALISASI", "IJIN KERJA", "IZIN KERJA", "KIP", "BPJS", "ASURANSI", "PEMBERSIHAN AWAL", "BOUWPLANK", "UITZET", "PENGUKURAN", "SEWA RUMAH", "LISTRIK KERJA", "AIR KERJA", "PAGAR SEMENTARA", "SETTING OUT"];
const KW_TANAH = ["GALIAN", "URUGAN", "URUG", "TIMBUNAN", "PEMADATAN", "PADAT", "CERUCUK", "DOLKEN", "TANAH", "LEVELLING", "LEVELING", "STRIPPING", "LAND CLEARING", "PASIR URUG"];
const KW_PONDASI = ["PONDASI", "FOOTPLAT", "FOOT PLAT", "TAPAK", "STROUS", "BORE PILE", "BOR PILE", "ANSTAMPING", "AANSTAMPING", "BATU KOSONG", "BATU KALI", "ROLLAG", "ROLAAG", "SLOOF", "LANTAI KERJA", "LEAN CONCRETE", "SUMURAN"];
const KW_STRUKTUR = ["KOLOM", "BALOK", "RING BALK", "RINGBALK", "PELAT", "PLAT LANTAI", "PEMBESIAN", "BEKESTING", "BEKISTING", "BETON", "READYMIX", "READY MIX", "WIREMESH", "WIRE MESH", "BESI BETON", "ANGKUR", "ANGKER", "ANCHOR", "DYNABOLT", "PRECAST", "BONDEK", "COR ", "K-225", "K-250", "K-300", "FC ", "STEK"];
const KW_DINDING = ["DINDING", "BATA", "BATAKO", "PASANGAN", "HEBEL", "HOLLOW", "ROSTER", "PARTISI", "BATU ALAM"];
const KW_ATAP = ["ATAP", "RANGKA ATAP", "KUDA-KUDA", "KUDA KUDA", "GORDING", "BAJA RINGAN", "SPANDEK", "SPANDECK", "GENTENG", "LISTPLANK", "LISPLANK", "LISTPLAND", "TALANG", "NOK", "REGEL", "JUREI"];
const KW_PLAFOND = ["PLAFOND", "PLAFON", "GYPSUM", "GRC PLAFOND", "RANGKA PLAFON", "HOLLOW PLAFON"];
const KW_FINISHING = ["KERAMIK", "GRANIT", "GRANITE", "PAVING", "KUSEN", "PINTU", "JENDELA", "CASEMENT", "KACA", "PENGECATAN", "CAT ", "DUCO", "WATERPROOF", "WATER PROOF", "RAILING", "HANDLE", "KUNCI", "SCREED", "PLESTERAN", "PLESTER", "ACIAN", "ACI ", "PROFIL", "HURUF TIMBUL", "PLINT", "WALLPAPER", "HANDRAIL", "GROUTING NAT", "LANTAI KERAMIK", "LANTAI GRANIT"];
const KW_LANSEKAP = ["PENANAMAN", "TANAMAN", "RUMPUT", "POHON", "TAMAN", "LANDSKAP", "LANSEKAP", "GAZEBO", "PAVING TAMAN"];

// Jalan.
const KW_BADAN_JALAN = ["SUBGRADE", "BADAN JALAN", "GALIAN", "TIMBUNAN", "PEMADATAN", "CLEARING", "TANAH DASAR", "SIRTU", "PEMBENTUKAN"];
const KW_DRAINASE = ["DRAINASE", "SALURAN", "GORONG", "GORONG-GORONG", "U-DITCH", "UDITCH", "BOX CULVERT", "PIPA DRAINASE", "SUMUR RESAPAN"];
const KW_LAPIS_PONDASI = ["AGREGAT", "LAPIS PONDASI", "LPA", "LPB", "BASE COURSE", "SUB BASE", "SUBBASE", "MACADAM", "TELFORD", "SIRTU PADAT"];
const KW_PERKERASAN = ["ASPAL", "HOTMIX", "AC-WC", "AC-BC", "AC-BASE", "ACWC", "ACBC", "PRIME COAT", "TACK COAT", "LASTON", "PENETRASI", "RIGID", "PERKERASAN BETON", "RABAT BETON", "PAVING BLOCK", "PAVING"];
const KW_PELENGKAP_JALAN = ["KANSTIN", "KANSTEEN", "KERB", "BAHU JALAN", "TROTOAR", "KANSTINE"];
const KW_MARKA = ["MARKA", "RAMBU", "GUARDRAIL", "GUARD RAIL", "PAKU JALAN", "ZEBRA", "RPPJ", "TRAFFIC"];

// Marine.
const KW_MARINE_SUB = ["PANCANG", "TIANG PANCANG", "GEOTEXTILE", "GEOTEKSTIL", "DREDGING", "PENGERUKAN", "GALIAN", "FILTER", "CERUCUK"];
const KW_MARINE_STRUKTUR = ["ARMOUR", "ARMOR", "BRONJONG", "BATU", "POER", "POCK", "BALOK", "PILECAP", "PILE CAP", "REVETMENT", "PASANGAN BATU", "BETON"];
const KW_MARINE_DECK = ["DECK", "LANTAI", "CAPPING", "FENDER", "BOLLARD", "BOULDER", "PLENGSENGAN ATAS", "TRESTLE"];

// Utilitas.
const KW_UTIL_GALIAN = ["GALIAN", "SUMUR BOR", "BOR", "PONDASI", "TANGKI", "TOWER", "MENARA", "TIANG"];
const KW_UTIL_PASANG = ["PIPA", "KABEL", "PANEL", "POMPA", "INSTALASI", "VALVE", "FLANGE", "GATE VALVE", "ACCESSORIES", "BIOTECH", "SEPTIC", "RENTENG", "TRAFO", "MCB", "KWH"];

const has = (n: string, kws: readonly string[]) => {
  for (const k of kws) if (n.includes(k)) return true;
  return false;
};

/**
 * Tahap sebuah item pada tipe unit tertentu. Kata kunci FIXTURE (lampu/sanitair)
 * & finishing dicek SEBELUM struktur/dinding supaya "pasang lampu di dinding"
 * tidak salah masuk tahap dinding. Nama item diperiksa; fallback per tipe.
 */
export function classifyStage(workType: WorkType, itemName: string, categoryName = ""): StageKey {
  const n = (itemName || "").toUpperCase();

  // Persiapan & testing bersifat lintas-tipe (cek dulu).
  if (has(n, KW_PERSIAPAN)) return "persiapan";
  if (has(n, KW_TESTING)) return workType === "gedung" ? "testing" : "testing";

  if (workType === "jalan") {
    if (has(n, KW_MARKA)) return "marka";
    if (has(n, KW_PERKERASAN)) return "perkerasan";
    if (has(n, KW_LAPIS_PONDASI)) return "lapis_pondasi";
    if (has(n, KW_DRAINASE)) return "drainase";
    if (has(n, KW_PELENGKAP_JALAN)) return "pelengkap_jalan";
    if (has(n, KW_BADAN_JALAN)) return "badan_jalan";
    return "lainnya";
  }

  if (workType === "marine") {
    if (has(n, KW_MARINE_DECK)) return "marine_deck";
    if (has(n, KW_MARINE_SUB)) return "marine_sub";
    if (has(n, KW_MARINE_STRUKTUR)) return "marine_struktur";
    return "lainnya";
  }

  if (workType === "utilitas") {
    if (has(n, KW_TESTING)) return "testing";
    if (has(n, KW_MEP_ROUGHIN_STRONG)) return "util_pasang";
    if (has(n, KW_MEP_FINISH) || has(n, KW_SANITAIR)) return "util_finish";
    if (has(n, KW_UTIL_PASANG) || has(n, KW_MEP_ROUGHIN)) return "util_pasang";
    if (has(n, KW_UTIL_GALIAN)) return "util_galian";
    return "lainnya";
  }

  if (workType === "lansekap") {
    if (has(n, KW_LANSEKAP)) return "lansekap";
    return "lansekap";
  }

  if (workType === "umum") {
    if (has(n, KW_TANAH)) return "tanah";
    return "lainnya";
  }

  // ── GEDUNG (paling kaya). Urutan cek dirancang agar kata kunci tumpang tindih
  // menang sesuai NIAT lapangan:
  //   fixture (lampu/sanitair) & MEP tanam dulu (agar "lampu dinding" ≠ dinding),
  //   finishing (termasuk plester/acian) sebelum dinding,
  //   lalu pondasi SEBELUM struktur SEBELUM dinding (footplat beton = pondasi,
  //   bukan struktur).
  if (has(n, KW_MEP_ROUGHIN_STRONG)) return "mep_roughin";
  if (has(n, KW_MEP_FINISH)) return "mep_finish";
  if (has(n, KW_SANITAIR)) return "sanitair";
  if (has(n, KW_MEP_ROUGHIN)) return "mep_roughin";
  if (has(n, KW_PLAFOND)) return "plafond";
  if (has(n, KW_ATAP)) return "atap";
  if (has(n, KW_FINISHING)) return "finishing";
  if (has(n, KW_PONDASI)) return "pondasi";
  if (has(n, KW_STRUKTUR)) return "struktur";
  if (has(n, KW_DINDING)) return "dinding";
  if (has(n, KW_TANAH)) return "tanah";
  void categoryName;
  return "lainnya";
}

// ── Penjadwalan ──────────────────────────────────────────────────────────────

export type SeqItem = { name: string; categoryName: string; amount: bigint };

export type ItemPlacement = {
  name: string;
  categoryName: string;
  workType: WorkType;
  stage: StageKey;
  start: number;
  end: number;
  weightPct: number;
};

/** Tempatkan tiap item pada jendela tahap unitnya (fraksi durasi) + bobot %. */
export function placeItems(items: SeqItem[]): ItemPlacement[] {
  const positive = items.filter((it) => it.amount > 0n);
  const grand = positive.reduce((s, it) => s + Number(it.amount), 0);
  if (grand <= 0) return [];

  // Tipe unit dideteksi PER-KATEGORI dari mayoritas item kategori itu.
  const itemsByCat = new Map<string, string[]>();
  for (const it of positive) {
    const arr = itemsByCat.get(it.categoryName) ?? [];
    arr.push(it.name);
    itemsByCat.set(it.categoryName, arr);
  }
  const typeByCat = new Map<string, WorkType>();
  for (const [cat, names] of itemsByCat) typeByCat.set(cat, detectWorkType(cat, names));

  return positive.map((it) => {
    const workType = typeByCat.get(it.categoryName) ?? "gedung";
    const stage = classifyStage(workType, it.name, it.categoryName);
    const def = stageDef(workType, stage);
    return {
      name: it.name,
      categoryName: it.categoryName,
      workType,
      stage,
      start: def.start,
      end: def.end,
      weightPct: (Number(it.amount) / grand) * 100,
    };
  });
}

/**
 * Kurva-S kumulatif mingguan dari penjadwalan berurut per-unit. Tiap item
 * disebar smoothstep dalam jendela tahapnya (konsisten dgn mesin lama), lalu
 * dijumlah. Mulai 0, akhir 100, monoton, bentuk-S.
 */
export function scheduleBySequence(items: SeqItem[], contractDays: number): number[] {
  const totalWeeks = Math.max(1, Math.ceil(contractDays / 7));
  const placements = placeItems(items);
  if (placements.length === 0) return new Array(totalWeeks).fill(0);
  return cumulativeFromSegments(
    placements.map((p) => ({ weightPct: p.weightPct, start: p.start, end: p.end })),
    totalWeeks,
  );
}

/** Urutan tahap di dalam tipe (untuk uji presedensi & rekomendasi). */
export function stageOrder(workType: WorkType): StageKey[] {
  return STAGE_TEMPLATES[workType].map((s) => s.key);
}

/**
 * Edge presedensi KERAS (tak boleh tumpang tindih: akhir pred ≤ mulai succ).
 * Dipakai uji invarian — pelanggaran = jadwal salah secara lapangan.
 */
export const HARD_EDGES: Record<WorkType, ReadonlyArray<readonly [StageKey, StageKey]>> = {
  gedung: [
    ["pondasi", "dinding"], // tak boleh pasang dinding sebelum pondasi
    ["struktur", "atap"], // atap butuh struktur
    ["atap", "plafond"], // plafond butuh atap
    ["dinding", "finishing"], // plester/cat setelah dinding
    ["finishing", "mep_finish"], // lampu/armatur setelah cat
    ["finishing", "sanitair"], // sanitair setelah finishing
  ],
  jalan: [
    ["badan_jalan", "lapis_pondasi"],
    ["lapis_pondasi", "perkerasan"],
    ["perkerasan", "marka"], // marka paling akhir
  ],
  marine: [["marine_struktur", "marine_deck"]],
  utilitas: [["util_pasang", "util_finish"]],
  lansekap: [],
  umum: [],
};

/** Fraksi rencana selesai (0..1) sebuah tahap pada akhir minggu tertentu. */
export function stagePlannedFraction(
  workType: WorkType,
  stage: StageKey,
  weekNumber: number,
  totalWeeks: number,
): number {
  const def = stageDef(workType, stage);
  const t = Math.max(0, Math.min(1, weekNumber / Math.max(1, totalWeeks)));
  const span = Math.max(1e-9, def.end - def.start);
  const x = (t - def.start) / span;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 3 * x * x - 2 * x * x * x; // smoothstep
}
