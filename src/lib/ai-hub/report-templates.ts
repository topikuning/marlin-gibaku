/**
 * Katalog template Report Studio — MURNI (aman utk klien). Satu structured
 * report kanonik per generate; renderer (HTML/cetak/WA/Excel) memakai konten
 * yang SAMA sehingga angka identik lintas format. DECISIONS 133.
 */

export type AiReportTemplateKey =
  | "exec_portfolio"
  | "exec_lokasi"
  | "mingguan_kkp"
  | "bulanan_kkp"
  | "owner_brief"
  | "kendala_recovery"
  | "wa_update";

export type AiReportTemplate = {
  key: AiReportTemplateKey;
  label: string;
  desc: string;
  /** Arahan tambahan utk AI saat menyusun konten template ini. */
  instruction: string;
  /** Versi template (tercatat di artefak). */
  version: number;
};

export const AI_REPORT_TEMPLATES: readonly AiReportTemplate[] = [
  {
    key: "exec_portfolio",
    label: "Executive Portfolio Brief",
    desc: "Ringkasan lintas lokasi untuk direksi: kondisi, prioritas, tindakan.",
    instruction:
      "Format untuk direksi: ringkas, tajam, mulai dari kesimpulan. Sertakan bagian per-lokasi hanya untuk lokasi bermasalah; lokasi stabil cukup satu kalimat kolektif.",
    version: 1,
  },
  {
    key: "exec_lokasi",
    label: "Executive Location Brief",
    desc: "Brief mendalam satu/beberapa lokasi terpilih.",
    instruction:
      "Satu bagian per lokasi: kondisi jadwal, kepatuhan lapor, kendala, langkah minggu depan. Pisahkan masalah data vs masalah fisik.",
    version: 1,
  },
  {
    key: "mingguan_kkp",
    label: "Laporan Mingguan (gaya KKP)",
    desc: "Ringkasan mingguan per lokasi/paket untuk pelaporan KKP.",
    instruction:
      "Struktur mingguan formal: capaian minggu ini, rencana vs realisasi, kendala & tindak lanjut, dokumentasi. Nada formal kelembagaan.",
    version: 1,
  },
  {
    key: "bulanan_kkp",
    label: "Laporan Bulanan (gaya KKP)",
    desc: "Rekap bulanan formal untuk pelaporan KKP.",
    instruction:
      "Struktur bulanan formal: progres kumulatif, deviasi & penjelasan, kendala berulang, kebutuhan dukungan. Nada formal kelembagaan.",
    version: 1,
  },
  {
    key: "owner_brief",
    label: "Owner / PPK Brief",
    desc: "Brief formal berbasis bukti untuk pemberi kerja.",
    instruction:
      "Formal & berbasis bukti: setiap klaim merujuk data (laporan final, foto, milestone). Hindari spekulasi; tandai jelas hal yang perlu validasi.",
    version: 1,
  },
  {
    key: "kendala_recovery",
    label: "Kendala & Recovery",
    desc: "Rekap kendala terbuka + status rencana pemulihan.",
    instruction:
      "Fokus kendala: daftar per lokasi dgn tingkat keparahan, status recovery, yang overdue, dan usulan eskalasi. Urutkan paling kritis dulu.",
    version: 1,
  },
  {
    key: "wa_update",
    label: "WhatsApp Update",
    desc: "Narasi ringkas untuk pimpinan via WA — angka sama dgn laporan.",
    instruction:
      "Sangat ringkas (maks ~1200 karakter di waSummary): kondisi umum 1-2 kalimat, 3-5 poin lokasi prioritas, penutup tindakan. Tanpa markdown.",
    version: 1,
  },
] as const;

export function aiReportTemplate(key: string): AiReportTemplate | undefined {
  return AI_REPORT_TEMPLATES.find((t) => t.key === key);
}

export function isAiReportTemplateKey(key: string): key is AiReportTemplateKey {
  return AI_REPORT_TEMPLATES.some((t) => t.key === key);
}
