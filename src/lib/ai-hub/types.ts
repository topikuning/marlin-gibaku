/**
 * Tipe bersama AI Intelligence Hub — MURNI (tanpa server-only) agar bisa
 * dipakai engine deterministik, komponen server, dan unit test. DECISIONS 133.
 *
 * Prinsip: AI BUKAN sumber angka. Semua angka pada tipe ini berasal dari
 * calculation layer MARLIN (lib/progress, lib/baseline, lib/forecast, dst.)
 * dan menjadi SATU-satunya dasar KPI/tabel; AI hanya menambah narasi.
 */

/** Referensi sumber data pembentuk analisis (untuk drawer "Sumber"). */
export type SourceRef = {
  id: string; // unik dlm satu run, mis. "tengket:progress"
  entityType: string; // location | daily_report | issue | recovery | photo | milestone | finance
  entityId: string;
  label: string;
  value?: string;
  updatedAt?: string;
  href?: string;
};

/** Fakta deterministik per lokasi — INPUT engine readiness/risk (murni). */
export type LocationFacts = {
  locationId: string;
  name: string;
  slug: string;
  packageName: string;
  province: string;
  status: string; // LocationStatus
  startDateKey: string | null; // SPMK; null = belum mulai
  hasActiveRab: boolean;
  hasActiveBaseline: boolean;
  totalWeeks: number;
  currentWeek: number;
  planPct: number;
  actualPct: number;
  deviationPp: number; // actual − plan (poin persen)
  expectedReports: number; // hari dalam periode yang ≥ SPMK (0 bila belum SPMK)
  finalReports: number;
  sentReports: number; // dikirim/disetujui (belum final)
  draftReports: number;
  needFixReports: number;
  daysSinceLastReport: number | null; // sejak laporan counted terakhir (all-time)
  activityCount: number; // kegiatan lapangan dlm periode
  photoCount: number; // foto dlm periode
  photosNoGps: number;
  photosServerTime: number; // waktu cap = waktu unggah (bukan jepret)
  openIssues: number;
  criticalIssues: number;
  issuesWithoutRecovery: number;
  overdueRecoveries: number;
  milestonesNeedFix: number;

  /* ── RENCANA KERJA: satu-satunya fakta yang menghadap KE DEPAN ──────────
   *
   * Keluhan user 2026-08-28: *"pekerjaan apa yang perlu dilakukan untuk
   * mengejar progress?"* dijawab **"Saya tidak punya angka bersumber untuk
   * menjawab itu"** — padahal drawer sitasinya penuh angka.
   *
   * Penolakannya JUJUR, dan itu yang menjadikannya cacat serius: seluruh fakta
   * di atas melaporkan apa yang SUDAH terjadi. Tidak satu pun menyebut apa yang
   * direncanakan. Model yang dipagari agar tidak mengarang memang tidak punya
   * pilihan lain selain menolak.
   *
   * Datanya sudah lama ada (`WeeklyPlan`) dan sudah dipakai formulir rencana
   * mingguan, PDF, Excel, dan siaran WhatsApp. Yang tidak ada cuma sambungannya
   * ke sini. Opsional karena lokasi tanpa kontrak/baseline memang belum punya
   * pekan bernomor — dan "belum ada" harus bisa dibedakan dari "nol". */
  /** Item yang direncanakan untuk pekan berjalan. null = pekannya belum bernomor. */
  plannedItemsThisWeek?: number | null;
  /** Nama beberapa item yang direncanakan — bahan jawaban "ngapain pekan ini". */
  plannedItemNames?: string[];
  /** Komitmen pekan LALU yang belum tuntas — bahan pertama untuk mengejar. */
  unfinishedLastWeek?: number | null;
};

export type ReadinessFinding = {
  key: string;
  label: string;
  detail?: string;
  weight: number; // pengurang skor
};

export type ReadinessResult = {
  score: number; // 0..100
  grade: "poor" | "limited" | "adequate" | "strong";
  blockers: ReadinessFinding[];
  warnings: ReadinessFinding[];
  passed: ReadinessFinding[];
};

export type RiskCategory = "schedule" | "data_quality" | "compliance" | "cost";
export type RiskSeverity = "sedang" | "tinggi" | "kritis";

export type RiskItem = {
  locationId: string;
  locationName: string;
  category: RiskCategory;
  severity: RiskSeverity;
  title: string;
  evidence: string;
  ruleScore: number; // 0..100 — deterministik, BUKAN dari AI
  overdue: boolean;
  sourceRefIds: string[];
};

export type QualityStatus = "lulus" | "periksa" | "gagal" | "info";

export type QualityFinding = {
  key: string;
  label: string;
  status: QualityStatus; // ditentukan RULE, tidak boleh oleh AI
  detail: string;
  locationId: string;
  locationName: string;
  count: number;
};

/** Ringkasan portofolio deterministik (KPI resmi halaman /ai). */
export type PulseTotals = {
  locations: number;
  reportsExpected: number;
  reportsFinal: number;
  negativeDeviationLocations: number;
  openIssues: number;
  overdueRecoveries: number;
  lowReadinessLocations: number; // grade poor/limited
};

export type PulseRow = LocationFacts & {
  readiness: ReadinessResult;
  riskScore: number; // maks ruleScore item risiko lokasi ini
  riskSeverity: RiskSeverity | null;
};

export type PortfolioPulse = {
  periodStart: string;
  periodEnd: string;
  /** Watermark data sumber terakhir berubah (ISO); null = belum ada data. */
  dataAsOf: string | null;
  totals: PulseTotals;
  rows: PulseRow[]; // exception-first
  risks: RiskItem[];
  sourceRefs: SourceRef[];
  /** Batas rekonstruksi snapshot (mis. entitas tanpa histori status). */
  limitations?: string[];
};
