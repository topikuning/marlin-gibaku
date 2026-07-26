/**
 * Katalog laporan eksekutif yang bisa disusun AI & dikirim ke WA. Murni (tanpa
 * DB) supaya aman dipakai klien. DECISIONS 122.
 */

export type ExecReportKey = "rangkuman_kegiatan" | "rekap_kendala" | "kepatuhan_lapor";

export type ExecReportMeta = {
  key: ExecReportKey;
  label: string;
  desc: string;
};

export const EXEC_REPORTS: readonly ExecReportMeta[] = [
  {
    key: "rangkuman_kegiatan",
    label: "Rangkuman Kegiatan Semua Lokasi",
    desc: "Ringkasan kegiatan, status laporan & kendala tiap lokasi dalam periode — untuk direksi.",
  },
  {
    key: "rekap_kendala",
    label: "Rekap Kendala",
    desc: "Kendala terbuka/kritis lintas lokasi beserta saran tindakan.",
  },
  {
    key: "kepatuhan_lapor",
    label: "Status Kepatuhan Lapor",
    desc: "Lokasi yang belum/ sudah mengirim laporan harian pada periode.",
  },
] as const;

export const EXEC_REPORT_KEYS = EXEC_REPORTS.map((r) => r.key);

export function isExecReportKey(k: string): k is ExecReportKey {
  return EXEC_REPORT_KEYS.includes(k as ExecReportKey);
}

export function execReportMeta(key: string): ExecReportMeta | undefined {
  return EXEC_REPORTS.find((r) => r.key === key);
}

/* ── Periode ─────────────────────────────────────────────────────────────── */

export type PeriodPreset = "hari_ini" | "kemarin" | "7hari" | "custom";

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "hari_ini", label: "Hari ini" },
  { value: "kemarin", label: "Kemarin" },
  { value: "7hari", label: "7 hari terakhir" },
  { value: "custom", label: "Rentang khusus" },
];

export function isPeriodPreset(v: string): v is PeriodPreset {
  return PERIOD_PRESETS.some((p) => p.value === v);
}
