import { promptDefault } from "@/lib/ai/prompt-registry";
import type { PortfolioPulse, PulseRow, QualityFinding, RiskItem } from "./types";

/**
 * Penyusun prompt AI Hub — data deterministik diringkas jadi payload kompak.
 * PROMPT_VERSION naik setiap perubahan format (tercatat di AiRun.promptVersion).
 * DECISIONS 133 · narasi lapangan DECISIONS 136.
 */

export const PROMPT_VERSION = "hub-v2";

export const SYSTEM_BASE = promptDefault("hub.system");

function rowLine(r: PulseRow): string {
  const parts = [
    `id=${r.locationId}`,
    `nama=${r.name}`,
    `paket=${r.packageName}`,
    `prov=${r.province}`,
    `status=${r.status}`,
    r.hasActiveBaseline
      ? `rencana=${r.planPct.toFixed(1)}% realisasi=${r.actualPct.toFixed(1)}% deviasi=${r.deviationPp.toFixed(1)}pp mgg=${r.currentWeek}/${r.totalWeeks}`
      : "baseline=belum_ada",
    `laporan_final=${r.finalReports}/${r.expectedReports}`,
    `laporan_proses=${r.sentReports} draft=${r.draftReports} koreksi=${r.needFixReports}`,
    r.daysSinceLastReport != null ? `lapor_terakhir=${r.daysSinceLastReport}hr_lalu` : "belum_pernah_lapor",
    `kegiatan=${r.activityCount} foto=${r.photoCount}`,
    `kendala=${r.openIssues}(kritis=${r.criticalIssues},tanpa_recovery=${r.issuesWithoutRecovery})`,
    `recovery_overdue=${r.overdueRecoveries}`,
    `readiness=${r.readiness.score}(${r.readiness.grade})`,
  ];
  return "- " + parts.join(" | ");
}

function riskLine(x: RiskItem): string {
  return `- [${x.category}/${x.severity} skor=${x.ruleScore}] ${x.locationName}: ${x.title} — ${x.evidence} (sumber: ${x.sourceRefIds.join(",")})`;
}

/** Risiko teratas yang ikut ke prompt; sisanya disebut jumlahnya, tidak dibuang diam-diam. */
const MAKS_RISIKO = 25;

/** Payload data pulse/variance/risk — kompak, satu baris per lokasi. */
export function buildPulsePayload(pulse: PortfolioPulse, opts?: { maxRows?: number }): string {
  const rows = pulse.rows.slice(0, opts?.maxRows ?? 30);
  const refs = pulse.sourceRefs.map((s) => `- ${s.id}: ${s.label}${s.value ? ` = ${s.value}` : ""}`);
  return [
    `PERIODE: ${pulse.periodStart} s/d ${pulse.periodEnd} (data terakhir berubah: ${pulse.dataAsOf ?? "belum ada data"})`,
    `TOTAL: ${pulse.totals.locations} lokasi | laporan final ${pulse.totals.reportsFinal}/${pulse.totals.reportsExpected} | deviasi negatif ${pulse.totals.negativeDeviationLocations} lokasi | kendala terbuka ${pulse.totals.openIssues} | recovery overdue ${pulse.totals.overdueRecoveries} | readiness rendah ${pulse.totals.lowReadinessLocations} lokasi`,
    "",
    "DATA PER LOKASI (angka RESMI — kutip persis):",
    ...rows.map(rowLine),
    "",
    "RISIKO (skor rule deterministik — jangan diubah):",
    ...(pulse.risks.length ? pulse.risks.slice(0, MAKS_RISIKO).map(riskLine) : ["- (tidak ada risiko terdeteksi rule)"]),
    // Pemotongan DISEBUTKAN. Daftar yang diam-diam dipangkas terbaca model (dan
    // pembaca laporannya) sebagai "cuma segini risikonya".
    ...(pulse.risks.length > MAKS_RISIKO
      ? [`- (+${pulse.risks.length - MAKS_RISIKO} risiko lain tidak ditampilkan; daftar dipotong ${MAKS_RISIKO} teratas menurut skor rule)`]
      : []),
    "",
    "DAFTAR SUMBER (pakai id ini utk sourceRefIds):",
    ...refs,
  ].join("\n");
}

/** Payload temuan kualitas data (utk run kualitas_data). */
export function buildQualityPayload(findings: QualityFinding[]): string {
  const active = findings.filter((f) => f.status === "gagal" || f.status === "periksa");
  return [
    "TEMUAN AUDIT KUALITAS DATA (status ditentukan rule — jangan diubah):",
    ...(active.length
      ? active.map(
          (f) => `- [${f.status}] ${f.locationName} · ${f.key}: ${f.label} — ${f.detail} (jumlah=${f.count})`,
        )
      : ["- Semua rule lulus."]),
  ].join("\n");
}

export const KIND_INSTRUCTION: Record<string, string> = {
  pulse: promptDefault("hub.kind.pulse"),
  deviasi: promptDefault("hub.kind.deviasi"),
  risiko: promptDefault("hub.kind.risiko"),
  kualitas_data: promptDefault("hub.kind.kualitas_data"),
  tanya: promptDefault("hub.kind.tanya"),
};

