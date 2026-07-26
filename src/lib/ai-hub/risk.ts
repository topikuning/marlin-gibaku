import type { LocationFacts, ReadinessResult, RiskItem, RiskSeverity } from "./types";

/**
 * Risk Intelligence — skor rule DETERMINISTIK per kategori (schedule, data
 * quality, compliance, cost*). ruleScore terpisah dari narasi AI; AI hanya
 * menjelaskan/memprioritaskan, tidak mengubah skor. Murni & unit-testable.
 * (*cost: baru terisi dari audit kualitas data — invoice > commitment.)
 *
 * CATATAN JUJUR: MARLIN tidak punya network/CPM antar-item, jadi TIDAK ada
 * klaim "critical path". Dimensi jadwal di sini = Schedule Health (deviasi
 * kurva-S + kemacetan lapor), sesuai data yang benar-benar ada. DECISIONS 133.
 */

function sevOf(score: number): RiskSeverity {
  if (score >= 80) return "kritis";
  if (score >= 60) return "tinggi";
  return "sedang";
}

export const RISK_CATEGORY_LABEL: Record<RiskItem["category"], string> = {
  schedule: "Jadwal",
  data_quality: "Kualitas data",
  compliance: "Kepatuhan",
  cost: "Biaya",
};

/** Bangun item risiko satu lokasi dari fakta + readiness. Hanya skor ≥ 40 yang muncul. */
export function computeRisks(f: LocationFacts, readiness: ReadinessResult): RiskItem[] {
  const items: RiskItem[] = [];
  const ref = (k: string) => `${f.slug}:${k}`;

  // ── Schedule Health ──
  if (f.hasActiveBaseline && f.startDateKey) {
    const dev = f.deviationPp; // negatif = tertinggal
    let score = 0;
    if (dev <= -20) score = 90;
    else if (dev <= -10) score = 75;
    else if (dev <= -5) score = 55;
    else if (dev < -2) score = 40; // tepat −2 pp masih toleransi wajar lapangan
    if (f.status === "terhenti") score = Math.max(score, 85);
    if (score >= 40) {
      items.push({
        locationId: f.locationId,
        locationName: f.name,
        category: "schedule",
        severity: sevOf(score),
        title:
          f.status === "terhenti"
            ? "Pekerjaan terhenti"
            : `Deviasi jadwal ${dev.toFixed(1)} pp`,
        evidence: `Rencana ${f.planPct.toFixed(1)}% vs realisasi ${f.actualPct.toFixed(1)}% (mgg ${f.currentWeek}/${f.totalWeeks})`,
        ruleScore: score,
        overdue: false,
        sourceRefIds: [ref("progress")],
      });
    }
  }

  // ── Data quality (dari readiness gate) ──
  if (readiness.grade === "poor" || readiness.grade === "limited") {
    const score = readiness.grade === "poor" ? Math.max(70, 100 - readiness.score) : 55;
    items.push({
      locationId: f.locationId,
      locationName: f.name,
      category: "data_quality",
      severity: sevOf(score),
      title: `Readiness data ${readiness.score}%`,
      evidence:
        readiness.blockers
          .concat(readiness.warnings)
          .slice(0, 3)
          .map((b) => b.label)
          .join("; ") || "Data belum lengkap",
      ruleScore: score,
      overdue: false,
      sourceRefIds: [ref("laporan"), ref("progress")],
    });
  }

  // ── Compliance / kendala ──
  if (f.criticalIssues > 0 || f.overdueRecoveries > 0 || f.issuesWithoutRecovery > 0) {
    let score = 0;
    if (f.criticalIssues > 0) score = Math.max(score, 70 + Math.min(20, f.criticalIssues * 5));
    if (f.overdueRecoveries > 0) score = Math.max(score, 60 + Math.min(25, f.overdueRecoveries * 8));
    if (f.issuesWithoutRecovery > 0) score = Math.max(score, 50);
    items.push({
      locationId: f.locationId,
      locationName: f.name,
      category: "compliance",
      severity: sevOf(score),
      title:
        f.overdueRecoveries > 0
          ? `${f.overdueRecoveries} recovery melewati target`
          : f.criticalIssues > 0
            ? `${f.criticalIssues} kendala kritis terbuka`
            : "Kendala tanpa rencana pemulihan",
      evidence: `${f.openIssues} kendala terbuka; ${f.issuesWithoutRecovery} tanpa recovery; ${f.overdueRecoveries} overdue`,
      ruleScore: score,
      overdue: f.overdueRecoveries > 0,
      sourceRefIds: [ref("kendala")],
    });
  }
  if (f.milestonesNeedFix > 0) {
    const score = 45 + Math.min(20, f.milestonesNeedFix * 5);
    items.push({
      locationId: f.locationId,
      locationName: f.name,
      category: "compliance",
      severity: sevOf(score),
      title: `${f.milestonesNeedFix} milestone administrasi perlu perbaikan`,
      evidence: "Dokumen/administrasi KKP tertahan pada status perlu_perbaikan",
      ruleScore: score,
      overdue: false,
      sourceRefIds: [ref("milestone")],
    });
  }

  return items.sort((a, b) => b.ruleScore - a.ruleScore);
}

/** Urut portofolio exception-first: risiko tertinggi → readiness terburuk → deviasi. */
export function exceptionFirst<T extends { riskScore: number; readiness: ReadinessResult; deviationPp: number }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      b.riskScore - a.riskScore ||
      a.readiness.score - b.readiness.score ||
      a.deviationPp - b.deviationPp,
  );
}
