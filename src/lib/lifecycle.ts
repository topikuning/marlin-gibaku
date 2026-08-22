import type {
  AiArtifactStatus,
  AiRunStatus,
  DailyReportStatus,
  LocationStatus,
  PackageStage,
} from "@/generated/prisma/enums";

/**
 * Mesin transisi status canonical (docs/rebuild/BUSINESS_LIFECYCLE.md).
 * Pure — dipakai server action (validasi) + unit test.
 */

export const PACKAGE_STAGE_ORDER: PackageStage[] = [
  "prospek",
  "tender",
  "penetapan",
  "kontrak",
  "pelaksanaan",
  "serah_terima",
  "selesai",
];

const PACKAGE_TRANSITIONS: Record<PackageStage, PackageStage[]> = {
  prospek: ["tender", "batal"],
  tender: ["penetapan", "batal"],
  penetapan: ["kontrak", "batal"],
  kontrak: ["pelaksanaan", "batal"],
  pelaksanaan: ["serah_terima"],
  serah_terima: ["selesai"],
  selesai: [],
  batal: [],
};

/**
 * Mundur (koreksi salah-klik) — HANYA langkah yang tak punya efek samping
 * destruktif. Kontrak↔penetapan & pelaksanaan↔kontrak sengaja DIKECUALIKAN
 * (menyangkut Contract, tanggal SPMK, dan status lokasi berjalan — perbaikannya
 * lewat Koreksi Kontrak / Batalkan, bukan mundur satu klik).
 */
const PACKAGE_REVERT: Partial<Record<PackageStage, PackageStage>> = {
  tender: "prospek",
  penetapan: "tender",
  serah_terima: "pelaksanaan",
  selesai: "serah_terima",
};

/** Stage sebelumnya yang aman untuk dimundurkan, atau null bila tak boleh. */
export function revertTargetFor(stage: PackageStage): PackageStage | null {
  return PACKAGE_REVERT[stage] ?? null;
}

const LOCATION_TRANSITIONS: Record<LocationStatus, LocationStatus[]> = {
  persiapan: ["berjalan", "batal"],
  berjalan: ["terhenti", "selesai", "batal"],
  terhenti: ["berjalan", "batal"],
  selesai: ["pho"],
  pho: ["pemeliharaan"],
  pemeliharaan: ["fho"],
  fho: [],
  batal: [],
};

const REPORT_TRANSITIONS: Record<DailyReportStatus, DailyReportStatus[]> = {
  draft: ["dikirim"],
  dikirim: ["perlu_koreksi", "disetujui"],
  perlu_koreksi: ["dikirim"],
  disetujui: ["final", "perlu_koreksi"],
  // Buka kunci final → disetujui: KOREKSI salah input yang baru ketahuan setelah
  // finalisasi. Bukan alur normal — aksinya digerbang capability khusus yang
  // hanya dimiliki super_admin, wajib alasan, dan tercatat di histori status.
  // DECISIONS 149.
  final: ["disetujui"],
};

/**
 * Status laporan harian yang IKUT DIHITUNG di angka resmi — progres, kurva-S,
 * deviasi, keuangan, KKP. Draft & perlu koreksi sengaja di luar: laporan yang
 * masih bisa diedit tidak boleh menggerakkan angka yang dipakai orang lain.
 *
 * Tinggal DI SINI, bukan di `progress.ts` (DECISIONS 415): `progress.ts`
 * menyentuh basis data, jadi modul aturan murni yang butuh daftar ini akan ikut
 * menyeret koneksi DB hanya untuk membaca tiga kata. `progress.ts` mengekspornya
 * ulang, jadi pemanggil lama tidak berubah.
 */
export const COUNTED_REPORT_STATUSES = ["dikirim", "disetujui", "final"] as const;

export function canTransitionPackage(from: PackageStage, to: PackageStage): boolean {
  return PACKAGE_TRANSITIONS[from].includes(to);
}

export function canTransitionLocation(from: LocationStatus, to: LocationStatus): boolean {
  return LOCATION_TRANSITIONS[from].includes(to);
}

export function canTransitionReport(from: DailyReportStatus, to: DailyReportStatus): boolean {
  return REPORT_TRANSITIONS[from].includes(to);
}

export const PACKAGE_STAGE_LABEL: Record<PackageStage, string> = {
  prospek: "Prospek",
  tender: "Tender",
  penetapan: "Penetapan",
  kontrak: "Kontrak",
  pelaksanaan: "Pelaksanaan",
  serah_terima: "Serah Terima",
  selesai: "Selesai",
  batal: "Batal",
};

export const LOCATION_STATUS_LABEL: Record<LocationStatus, string> = {
  persiapan: "Persiapan",
  berjalan: "Berjalan",
  terhenti: "Terhenti",
  selesai: "Selesai Fisik",
  pho: "PHO",
  pemeliharaan: "Pemeliharaan",
  fho: "FHO",
  batal: "Batal",
};

export const REPORT_STATUS_LABEL: Record<DailyReportStatus, string> = {
  draft: "Draft",
  dikirim: "Dikirim",
  perlu_koreksi: "Perlu Koreksi",
  disetujui: "Disetujui",
  final: "Final",
};

/** Tone badge per status — dipakai StatusPill (satu tempat, tidak tersebar). */
export const REPORT_STATUS_TONE: Record<DailyReportStatus, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral",
  dikirim: "info",
  perlu_koreksi: "warning",
  disetujui: "success",
  final: "success",
};

export const PACKAGE_STAGE_TONE: Record<PackageStage, "neutral" | "info" | "warning" | "success" | "danger"> = {
  prospek: "neutral",
  tender: "info",
  penetapan: "info",
  kontrak: "info",
  pelaksanaan: "warning",
  serah_terima: "info",
  selesai: "success",
  batal: "danger",
};

export const LOCATION_STATUS_TONE: Record<LocationStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  persiapan: "neutral",
  berjalan: "info",
  terhenti: "warning",
  selesai: "success",
  pho: "success",
  pemeliharaan: "info",
  fho: "success",
  batal: "danger",
};

/* ── Artefak laporan AI (AI Hub, DECISIONS 133) ─────────────────────────── */

const AI_ARTIFACT_TRANSITIONS: Record<AiArtifactStatus, AiArtifactStatus[]> = {
  draft: ["direview"],
  direview: ["disetujui", "draft"], // kembalikan ke draft = minta perbaikan
  disetujui: ["beku", "direview"],
  beku: ["terkirim"], // beku immutable — hanya boleh didistribusikan
  terkirim: ["terkirim"], // boleh dikirim ulang ke target lain
};

export function canTransitionAiArtifact(from: AiArtifactStatus, to: AiArtifactStatus): boolean {
  return AI_ARTIFACT_TRANSITIONS[from]?.includes(to) ?? false;
}

export const AI_ARTIFACT_STATUS_LABEL: Record<AiArtifactStatus, string> = {
  draft: "Draft AI",
  direview: "Sedang direview",
  disetujui: "Disetujui",
  beku: "Beku (final)",
  terkirim: "Terkirim",
};

export const AI_ARTIFACT_STATUS_TONE: Record<AiArtifactStatus, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral",
  direview: "warning",
  disetujui: "info",
  beku: "success",
  terkirim: "success",
};

export const AI_RUN_STATUS_LABEL: Record<AiRunStatus, string> = {
  berjalan: "Berjalan",
  siap: "Siap",
  gagal: "Gagal",
};

export const AI_RUN_STATUS_TONE: Record<AiRunStatus, "info" | "success" | "danger"> = {
  berjalan: "info",
  siap: "success",
  gagal: "danger",
};
