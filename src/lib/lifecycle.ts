import type {
  AiArtifactStatus,
  AiRunStatus,
  DailyReportStatus,
  EvidenceVerifStatus,
  FindingCategory,
  FindingStatus,
  InspectionStatus,
  IssueSeverity,
  LocationStatus,
  PackageStage,
  ReportVerifStatus,
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

/**
 * Level TERVERIFIKASI (internal): disetujui + final — laporan yang sudah
 * melewati verifikasi Site Manager. DIPAKAI HANYA sebagai angka PENDAMPING
 * (mesin kesiapan termin/PHO, label "Progress Terverifikasi") — angka RESMI
 * tetap `COUNTED_REPORT_STATUSES`; memindahkan basis resmi adalah keputusan
 * user yang masih terbuka di OPEN_ISSUES ("Level status progress").
 * Catatan: ini BUKAN verifikasi Wakil PPK (`ReportVerification`) — jejak itu
 * tidak menggerakkan angka mana pun. DECISIONS 426.
 */
export const VERIFIED_REPORT_STATUSES = ["disetujui", "final"] as const;

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

/* ── Tingkat keparahan (dipakai Issue DAN Finding) ──────────────────────── */

/**
 * SATU peta label & tone untuk `IssueSeverity` — dulu ditulis ulang di ≥6
 * berkas dan sempat menyimpang (Beranda mewarnai `tinggi` merah di kartu
 * kendala tapi kuning di kartu temuan, pada halaman yang sama). Rumah label +
 * tone memang di sini; jangan salin lagi.
 */
export const ISSUE_SEVERITY_LABEL: Record<IssueSeverity, string> = {
  rendah: "Rendah",
  sedang: "Sedang",
  tinggi: "Tinggi",
  kritis: "Kritis",
};

export const ISSUE_SEVERITY_TONE: Record<IssueSeverity, "neutral" | "info" | "warning" | "danger"> = {
  rendah: "neutral",
  sedang: "info",
  tinggi: "warning",
  kritis: "danger",
};

/* ── Temuan / inspeksi / verifikasi eksternal (DECISIONS 426) ───────────── */

/** Label kategori temuan — satu tempat untuk layar, PDF, dan Excel. */
export const FINDING_CATEGORY_LABEL: Record<FindingCategory, string> = {
  mutu: "Mutu",
  volume: "Volume",
  k3: "K3",
  administrasi: "Administrasi",
  jadwal: "Jadwal",
  lingkungan: "Lingkungan",
  lainnya: "Lainnya",
};

/**
 * Siklus temuan. "Ditindaklanjuti" BELUM selesai — hanya verifikator yang
 * menutup (siapa boleh transisi apa ditegakkan di actions lewat capability
 * `finding.respond` vs `finding.verify`; mesin ini hanya menjawab boleh/tidak
 * dari sisi bentuk siklusnya).
 */
const FINDING_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  baru: ["menunggu_klarifikasi", "ditindaklanjuti", "menunggu_verifikasi", "selesai"],
  menunggu_klarifikasi: ["ditindaklanjuti", "menunggu_verifikasi", "selesai"],
  ditindaklanjuti: ["menunggu_klarifikasi", "menunggu_verifikasi", "selesai"],
  // Verifikator menolak → kembali ditindaklanjuti (dengan alasan).
  menunggu_verifikasi: ["selesai", "ditindaklanjuti"],
  selesai: ["dibuka_kembali"],
  dibuka_kembali: ["menunggu_klarifikasi", "ditindaklanjuti", "menunggu_verifikasi", "selesai"],
};

export function canTransitionFinding(from: FindingStatus, to: FindingStatus): boolean {
  return FINDING_TRANSITIONS[from]?.includes(to) ?? false;
}

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  baru: "Baru",
  menunggu_klarifikasi: "Menunggu Klarifikasi",
  ditindaklanjuti: "Ditindaklanjuti",
  menunggu_verifikasi: "Menunggu Verifikasi",
  selesai: "Selesai",
  dibuka_kembali: "Dibuka Kembali",
};

export const FINDING_STATUS_TONE: Record<
  FindingStatus,
  "neutral" | "info" | "warning" | "success" | "danger"
> = {
  baru: "danger",
  menunggu_klarifikasi: "warning",
  ditindaklanjuti: "info",
  menunggu_verifikasi: "warning",
  selesai: "success",
  dibuka_kembali: "danger",
};

/** Status temuan yang dihitung TERBUKA (papan, EWS, kesiapan). */
export const OPEN_FINDING_STATUSES = [
  "baru",
  "menunggu_klarifikasi",
  "ditindaklanjuti",
  "menunggu_verifikasi",
  "dibuka_kembali",
] as const;

const INSPECTION_TRANSITIONS: Record<InspectionStatus, InspectionStatus[]> = {
  draft: ["final"],
  final: [],
};

export function canTransitionInspection(from: InspectionStatus, to: InspectionStatus): boolean {
  return INSPECTION_TRANSITIONS[from]?.includes(to) ?? false;
}

export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  draft: "Draft",
  final: "Final",
};

export const INSPECTION_STATUS_TONE: Record<InspectionStatus, "neutral" | "success"> = {
  draft: "neutral",
  final: "success",
};

/**
 * Verifikasi eksternal laporan harian: BUKAN state machine tersimpan — tiap
 * aksi menambah baris `ReportVerification`; label & tone-nya saja yang kanonik
 * di sini. "Belum diperiksa" = tidak ada baris.
 */
export const REPORT_VERIF_STATUS_LABEL: Record<ReportVerifStatus, string> = {
  diverifikasi: "Diverifikasi Wakil PPK",
  perlu_klarifikasi: "Perlu Klarifikasi",
  ditolak: "Ditolak – Perlu Koreksi",
};

export const REPORT_VERIF_STATUS_TONE: Record<ReportVerifStatus, "info" | "warning" | "success" | "danger"> = {
  diverifikasi: "success",
  perlu_klarifikasi: "warning",
  ditolak: "danger",
};

export const EVIDENCE_VERIF_STATUS_LABEL: Record<EvidenceVerifStatus, string> = {
  belum: "Belum diperiksa",
  diterima: "Diterima",
  ditolak: "Ditolak",
};

export const EVIDENCE_VERIF_STATUS_TONE: Record<EvidenceVerifStatus, "neutral" | "success" | "danger"> = {
  belum: "neutral",
  diterima: "success",
  ditolak: "danger",
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
