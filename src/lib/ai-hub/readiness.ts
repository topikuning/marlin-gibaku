import type { LocationFacts, ReadinessFinding, ReadinessResult } from "./types";

/**
 * Data Readiness Gate — rule deterministik + bobot EKSPLISIT, murni (unit-
 * testable). Menjawab: "seberapa layak data lokasi ini dianalisis/dilaporkan?"
 * AI tidak pernah menentukan skor; AI hanya menjelaskan hasil rule ini.
 * DECISIONS 133.
 */

const GRADE_STRONG = 85;
const GRADE_ADEQUATE = 70;
const GRADE_LIMITED = 50;

export function gradeOf(score: number): ReadinessResult["grade"] {
  if (score >= GRADE_STRONG) return "strong";
  if (score >= GRADE_ADEQUATE) return "adequate";
  if (score >= GRADE_LIMITED) return "limited";
  return "poor";
}

export const READINESS_GRADE_LABEL: Record<ReadinessResult["grade"], string> = {
  strong: "Kuat",
  adequate: "Memadai",
  limited: "Terbatas",
  poor: "Buruk",
};

/** Hitung readiness satu lokasi dari fakta deterministik. */
export function computeReadiness(f: LocationFacts): ReadinessResult {
  const blockers: ReadinessFinding[] = [];
  const warnings: ReadinessFinding[] = [];
  const passed: ReadinessFinding[] = [];

  const check = (
    key: string,
    label: string,
    bad: boolean,
    weight: number,
    blocker: boolean,
    detail?: string,
  ) => {
    if (bad) (blocker ? blockers : warnings).push({ key, label, weight, detail });
    else passed.push({ key, label, weight: 0 });
  };

  // Fondasi struktur data.
  check("rab_aktif", "RAB aktif tersedia", !f.hasActiveRab, 30, true);
  // Tanpa RAB, baseline MUSTAHIL ada — jadi potongannya harus ikut jatuh.
  // Dulu syaratnya `hasActiveRab && !hasActiveBaseline`, sehingga lokasi tanpa
  // RAB hanya kehilangan 30 poin → skor 70 → tergolong "Memadai". Akibatnya
  // lokasi yang datanya kosong total tampak sehat, tidak masuk daftar readiness
  // rendah, dan tidak memicu rule risiko — Perlu Tindakan bisa menyatakan
  // "tidak ada masalah" untuk portofolio yang belum berisi apa pun.
  // DECISIONS 196.
  check("baseline_aktif", "Baseline kurva-S aktif tersedia", !f.hasActiveBaseline, 25, true);

  const started = f.startDateKey != null;
  // Kepatuhan lapor dalam periode (hanya relevan setelah SPMK).
  if (started && f.expectedReports > 0) {
    const finalGap = f.expectedReports - f.finalReports;
    const gapRatio = finalGap / f.expectedReports;
    check(
      "laporan_final",
      "Laporan harian difinalkan sesuai periode",
      gapRatio > 0.5,
      Math.min(25, Math.round(gapRatio * 25)),
      f.finalReports === 0 && (f.photoCount > 0 || f.activityCount > 0),
      `${f.finalReports}/${f.expectedReports} final`,
    );
    check(
      "laporan_menggantung",
      "Tidak ada laporan menggantung (draft/perlu koreksi)",
      f.draftReports + f.needFixReports > 2,
      8,
      false,
      `${f.draftReports} draft, ${f.needFixReports} perlu koreksi`,
    );
  }
  // Kesegaran data (all-time; hanya bila proyek berjalan).
  if (started && f.status === "berjalan") {
    check(
      "data_segar",
      "Ada laporan dalam 14 hari terakhir",
      f.daysSinceLastReport == null || f.daysSinceLastReport > 14,
      20,
      f.daysSinceLastReport == null || f.daysSinceLastReport > 30,
      f.daysSinceLastReport == null ? "belum pernah lapor" : `${f.daysSinceLastReport} hari lalu`,
    );
  }
  // Bukti visual vs realisasi.
  check(
    "bukti_vs_realisasi",
    "Realisasi selaras dengan bukti foto/kegiatan",
    f.actualPct <= 0 && (f.photoCount >= 5 || f.activityCount >= 2) && started,
    15,
    false,
    `${f.photoCount} foto & ${f.activityCount} kegiatan, realisasi ${f.actualPct.toFixed(1)}%`,
  );
  // Kualitas metadata foto.
  if (f.photoCount > 0) {
    check(
      "foto_gps",
      "Mayoritas foto punya GPS asli",
      f.photosNoGps / f.photoCount > 0.5,
      6,
      false,
      `${f.photosNoGps}/${f.photoCount} tanpa GPS`,
    );
    check(
      "foto_waktu",
      "Mayoritas foto punya waktu jepret asli",
      f.photosServerTime / f.photoCount > 0.5,
      5,
      false,
      `${f.photosServerTime}/${f.photoCount} pakai waktu unggah`,
    );
  }
  // Kendala & pemulihan.
  check(
    "kendala_recovery",
    "Kendala kritis punya rencana pemulihan",
    f.criticalIssues > 0 && f.issuesWithoutRecovery > 0,
    10,
    false,
    `${f.issuesWithoutRecovery} kendala tanpa recovery`,
  );
  check(
    "recovery_tepat",
    "Recovery tidak melewati target",
    f.overdueRecoveries > 0,
    8,
    false,
    `${f.overdueRecoveries} recovery overdue`,
  );
  check(
    "milestone",
    "Milestone administrasi tanpa perbaikan tertunda",
    f.milestonesNeedFix > 0,
    5,
    false,
    `${f.milestonesNeedFix} milestone perlu perbaikan`,
  );

  const deduction = [...blockers, ...warnings].reduce((s, x) => s + x.weight, 0);
  const score = Math.max(0, Math.min(100, 100 - deduction));
  return { score, grade: gradeOf(score), blockers, warnings, passed };
}
