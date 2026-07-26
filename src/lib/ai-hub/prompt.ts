import type { PortfolioPulse, PulseRow, QualityFinding, RiskItem } from "./types";

/**
 * Penyusun prompt AI Hub — data deterministik diringkas jadi payload kompak.
 * PROMPT_VERSION naik setiap perubahan format (tercatat di AiRun.promptVersion).
 * DECISIONS 133 · narasi lapangan DECISIONS 136.
 */

export const PROMPT_VERSION = "hub-v2";

export const SYSTEM_BASE = `Anda asisten analisis MARLIN (pengendalian proyek Kampung Nelayan Merah Putih).
ATURAN MUTLAK:
1. Anda BUKAN sumber angka. Jangan menghitung ulang, membulatkan berbeda, atau mengarang angka apa pun — kutip persis angka yang diberikan.
2. Hanya sebut lokasi yang ada di DATA. Jangan menambah lokasi lain.
3. Setiap klaim harus merujuk sourceRefIds dari DAFTAR SUMBER.
4. Bedakan tegas: masalah DATA (laporan belum masuk/final) vs masalah FISIK (pekerjaan benar-benar terlambat). Deviasi besar dengan laporan kosong = validasi data dulu, BUKAN otomatis keterlambatan fisik.
5. Tidak ada critical path/CPM di MARLIN — jangan mengklaimnya. Gunakan istilah "kesehatan jadwal".
6. NARASI LAPANGAN (catatan laporan harian & kegiatan) boleh dikutip/dirangkum apa adanya sebagai konteks kualitatif, TAPI tidak pernah jadi sumber angka progres/deviasi — angka tetap dari DATA PER LOKASI. Anda TIDAK melihat foto (hanya jumlahnya) — jangan mengklaim mendeskripsikan isi foto.
7. Bahasa Indonesia operasional, langsung, tanpa basa-basi. Anda tidak memutuskan apa pun — manusia yang memutuskan.`;

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

/** Payload data pulse/variance/risk — kompak, satu baris per lokasi. */
export function buildPulsePayload(pulse: PortfolioPulse, opts?: { maxRows?: number }): string {
  const rows = pulse.rows.slice(0, opts?.maxRows ?? 30);
  const refs = pulse.sourceRefs.map((s) => `- ${s.id}: ${s.label}${s.value ? ` = ${s.value}` : ""}`);
  return [
    `PERIODE: ${pulse.periodStart} s/d ${pulse.periodEnd} (data per ${pulse.dataAsOf})`,
    `TOTAL: ${pulse.totals.locations} lokasi | laporan final ${pulse.totals.reportsFinal}/${pulse.totals.reportsExpected} | deviasi negatif ${pulse.totals.negativeDeviationLocations} lokasi | kendala terbuka ${pulse.totals.openIssues} | recovery overdue ${pulse.totals.overdueRecoveries} | readiness rendah ${pulse.totals.lowReadinessLocations} lokasi`,
    "",
    "DATA PER LOKASI (angka RESMI — kutip persis):",
    ...rows.map(rowLine),
    "",
    "RISIKO (skor rule deterministik — jangan diubah):",
    ...(pulse.risks.length ? pulse.risks.slice(0, 25).map(riskLine) : ["- (tidak ada risiko terdeteksi rule)"]),
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
  pulse:
    "Buat ringkasan Portfolio Pulse: kondisi umum, lokasi prioritas (maks 5-7) dengan alasan berbasis data, tindakan yang layak dipertimbangkan (draft, non-eksekusi), dan apa yang berubah bila data pembanding diberikan. Manfaatkan NARASI LAPANGAN (bila ada) untuk menjelaskan APA yang terjadi di lokasi prioritas, bukan cuma angkanya.",
  deviasi:
    "Jelaskan deviasi tiap lokasi dalam scope: pisahkan (a) deviasi resmi, (b) kesenjangan data, (c) penyebab fisik TERKONFIRMASI (ada bukti di data — termasuk kendala/solusi di NARASI LAPANGAN bila relevan), (d) penyebab DIDUGA (perlu cek lapangan), (e) validasi yang wajib dilakukan. Jangan mengubah angka deviasi resmi.",
  risiko:
    "Prioritaskan risiko lintas lokasi: beri rasional per item risiko rule (kenapa penting, apa dampaknya, urutan penanganan), perkuat dengan kutipan NARASI LAPANGAN (kendala/solusi) bila mendukung. Skor rule TIDAK boleh diubah — Anda hanya memberi penjelasan dan urutan fokus.",
  kualitas_data:
    "Jelaskan temuan audit kualitas data: apa arti tiap temuan, dampaknya pada keandalan angka, dan langkah perbaikan datanya. Status temuan ditentukan rule, bukan Anda.",
  tanya:
    "Jawab pertanyaan user HANYA dari data yang diberikan (termasuk NARASI LAPANGAN bila relevan, mis. \"laporan hari ini ada apa saja\"). Bila data tidak cukup untuk menjawab, katakan tidak cukup dan sebut data apa yang kurang.",
};
