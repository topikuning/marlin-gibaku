/**
 * Template milestone administrasi KKP — port dari kode lama
 * (b6e77af src/lib/kkp-admin-flow.ts, Alur Administrasi KNMP 2025 / DJPT).
 * Urutan & nama Indonesia dipertahankan; fase lama dipetakan ke enum
 * MilestonePhase schema baru. docTypes = tipe Dokumen (enum DocumentType,
 * string literal) yang jadi bukti otomatis milestone tsb.
 * requiresVerification = true untuk dokumen kritis
 * (kontrak, sppbj, spmk, bast_pho, bast_fho, ba_pembayaran).
 *
 * scope (DECISIONS 078):
 *   - "paket" = milestone tingkat INDUK/kontrak, satu untuk seluruh paket
 *     (locationId = null). Mayoritas administrasi PBJ: SPPBJ, kontrak, jaminan,
 *     SPMK, PCM (acara berbarengan), adendum, termin, SCM, PHO/FHO atas semua lokasi.
 *   - "lokasi" = milestone FISIK per lokasi (locationId terisi). Hanya serah
 *     terima lokasi & MC-0 (tiap desa diukur & disesuaikan sendiri).
 * Status milestone diturunkan dari dokumen yang diunggah (docTypes) — bukan flag
 * manual: unggah dokumen induk → milestone induk (satu), unggah dokumen lokasi →
 * milestone lokasi tsb.
 */

export type MilestonePhase =
  | "pemilihan"
  | "penunjukan"
  | "kontrak"
  | "mulai_kerja"
  | "pelaksanaan"
  | "adendum"
  | "serah_terima"
  | "pembayaran";

/** Scope milestone: induk paket (satu) atau per lokasi. */
export type MilestoneScope = "paket" | "lokasi";

// Subset enum DocumentType (prisma/schema.prisma) — string literal, tanpa Prisma client.
export type MilestoneDocType =
  | "undangan"
  | "sppbj"
  | "kontrak"
  | "jaminan"
  | "spmk"
  | "ba_serah_terima_lapangan"
  | "pcm"
  | "mc0"
  | "laporan"
  | "adendum"
  | "surat_peringatan"
  | "bast_pho"
  | "bast_fho"
  | "ba_pembayaran"
  | "invoice"
  | "hps";

export type AdminMilestone = {
  key: string;
  name: string;
  phase: MilestonePhase;
  scope: MilestoneScope;
  docTypes: string[];
  requiresVerification: boolean;
  sortOrder: number;
};

const M = (
  key: string,
  name: string,
  phase: MilestonePhase,
  docTypes: MilestoneDocType[] = [],
  requiresVerification = false,
  scope: MilestoneScope = "paket",
): Omit<AdminMilestone, "sortOrder"> => ({ key, name, phase, scope, docTypes, requiresVerification });

/** Per lokasi: hanya serah terima lokasi & MC-0 (tiap desa sendiri-sendiri). */
const L = (
  key: string,
  name: string,
  phase: MilestonePhase,
  docTypes: MilestoneDocType[] = [],
  requiresVerification = false,
): Omit<AdminMilestone, "sortOrder"> => M(key, name, phase, docTypes, requiresVerification, "lokasi");

const ITEMS: Omit<AdminMilestone, "sortOrder">[] = [
  // 1. Perencanaan & Persiapan (lama: "perencanaan") → pemilihan — INDUK
  M("rab-hps", "RAB HPS", "pemilihan", ["hps"]),
  M("ded", "DED (Detail Engineering Design)", "pemilihan"),
  M("rks", "RKS (Rencana Kerja & Syarat)", "pemilihan"),
  M("smkk", "SMKK (Sistem Manajemen Keselamatan Konstruksi)", "pemilihan"),

  // 2. Penunjukan & Kontrak (lama: "penunjukan") → penunjukan + kontrak — INDUK
  M("sppbj", "SPPBJ", "penunjukan", ["sppbj"], true),
  M("pakta-integritas", "Pakta Integritas", "penunjukan"),
  M("jaminan-pelaksanaan", "Jaminan Pelaksanaan", "penunjukan", ["jaminan"]),
  M("keabsahan-jaminan-pelaksanaan", "Keabsahan Jaminan Pelaksanaan", "penunjukan"),
  M("undangan-kontrak", "Undangan Pembahasan & Penandatanganan Kontrak", "kontrak", ["undangan"]),
  M("kontrak", "Kontrak (Surat Perjanjian)", "kontrak", ["kontrak"], true),

  // 3. Serah Terima Lokasi & Mulai Kerja (lama: "serah_lokasi") → mulai_kerja
  //    SPMK = INDUK (satu perintah mulai kerja); peninjauan & serah terima lokasi = PER LOKASI.
  L("undangan-peninjauan-lokasi", "Undangan Peninjauan Lokasi Bersama", "mulai_kerja", ["undangan"]),
  L("pernyataan-pemahaman-lokasi", "Surat Pernyataan Pemahaman Lokasi (Kontraktor)", "mulai_kerja"),
  L("ba-serah-terima-lokasi", "BA Serah Terima Lokasi + lampiran peninjauan", "mulai_kerja", ["ba_serah_terima_lapangan"]),
  M("spmk", "SPMK (Surat Perintah Mulai Kerja)", "mulai_kerja", ["spmk"], true),

  // 4. PCM & Mutual Check 0% (lama: "pcm_mc0") → mulai_kerja
  //    PCM = INDUK (acara berbarengan); MC-0 = PER LOKASI (tiap desa diukur & disesuaikan sendiri).
  M("undangan-pcm", "Undangan PCM", "mulai_kerja", ["undangan"]),
  M("ba-pcm", "BA PCM (+ RMPK, RKK, dokumen pendukung)", "mulai_kerja", ["pcm"]),
  L("permohonan-kesiapan-mc0", "Surat Permohonan Kesiapan MC-0", "mulai_kerja"),
  L("undangan-pelaksanaan-mc0", "Undangan Pelaksanaan MC-0", "mulai_kerja", ["undangan"]),
  L("ba-pemeriksaan-bersama-mc0", "BA Pemeriksaan Bersama (Kontraktor–Pengawas)", "mulai_kerja"),
  L("justifikasi-teknis-pengawas", "Justifikasi Teknis Pengawas", "mulai_kerja"),
  L("undangan-pembahasan-mc0", "Undangan Pembahasan MC-0", "mulai_kerja", ["undangan"]),
  L("ba-persetujuan-mc0", "BA Pembahasan & Persetujuan MC-0", "mulai_kerja", ["mc0"]),

  // 5. Adendum / CCO (lama: "cco") → adendum — INDUK (kontrak)
  M("adendum-1-kontrak", "Adendum 1 Kontrak", "adendum", ["adendum"]),
  M("permohonan-cco", "Permohonan CCO (+ RAB & back-up perhitungan)", "adendum"),
  M("ba-perhitungan-bersama-cco", "BA Perhitungan Bersama (Kontraktor–Pengawas)", "adendum"),
  M("justifikasi-teknis-cco", "Justifikasi Teknis Penambahan/Pengurangan", "adendum"),
  M("undangan-pembahasan-cco", "Undangan Pembahasan CCO", "adendum", ["undangan"]),
  M("ba-pembahasan-cco", "BA Pembahasan CCO", "adendum"),
  M("persetujuan-cco", "Persetujuan CCO (+ tambahan Jaminan Pelaksanaan bila naik)", "adendum"),
  M("undangan-penandatanganan-adendum", "Undangan Penandatanganan Adendum", "adendum", ["undangan"]),
  M("adendum-surat-perjanjian", "Adendum Surat Perjanjian (Kontrak)", "adendum", ["adendum"]),

  // 6. Termin & Pembayaran (lama: "termin") → pembayaran — INDUK (BAP tingkat kontrak,
  //    termin dinilai dari PROGRES TOTAL kontrak: 20/25/30/25 @ 25/50/80/100%).
  M("ba-pembahasan-kemajuan", "BA Pembahasan Kemajuan Pekerjaan", "pembayaran"),
  M("laporan-kemajuan", "Laporan Kemajuan Pekerjaan", "pembayaran", ["laporan"]),
  M("permohonan-pemeriksaan-pekerjaan", "Permohonan Pemeriksaan Pekerjaan", "pembayaran"),
  M("ba-pemeriksaan-pekerjaan", "BA Pemeriksaan Pekerjaan", "pembayaran"),
  M("ba-persetujuan-persentase", "BA Persetujuan Persentase Pekerjaan", "pembayaran"),
  M("permohonan-pembayaran", "Surat Permohonan Pembayaran (+ kwitansi, e-faktur, NPWP)", "pembayaran", ["invoice"]),
  M("ba-pembayaran", "Berita Acara Pembayaran (BAP)", "pembayaran", ["ba_pembayaran"], true),

  // 7. Kontrak Kritis / SCM (lama: "scm") → pelaksanaan — INDUK
  M("surat-peringatan-kontrak-kritis", "Surat Peringatan Kontrak Kritis", "pelaksanaan", ["surat_peringatan"]),
  M("undangan-ba-scm", "Undangan & BA Show Cause Meeting (SCM)", "pelaksanaan"),
  M("ba-pembuktian-scm", "BA Pembuktian SCM", "pelaksanaan"),
  M("adendum-pemberian-kesempatan", "Adendum Pemberian Kesempatan (bila diberikan)", "pelaksanaan", ["adendum"]),

  // 8. Serah Terima Pekerjaan (lama: "serah_terima") → serah_terima — INDUK
  //    PHO/FHO final atas SEMUA lokasi. (Serah terima parsial per pekerjaan selesai =
  //    fitur tersendiri, belum di sini.)
  M("permohonan-pho", "Permohonan & BA Serah Terima Pertama (PHO)", "serah_terima"),
  M("bast-pho", "BAST-1 / PHO (Provisional Hand Over)", "serah_terima", ["bast_pho"], true),
  M("bast-fho", "BAST-2 / FHO (Final Hand Over)", "serah_terima", ["bast_fho"], true),
];

export const ADMIN_MILESTONE_TEMPLATE: AdminMilestone[] = ITEMS.map((it, i) => ({
  ...it,
  sortOrder: i + 1,
}));

export const ADMIN_MILESTONE_TOTAL = ADMIN_MILESTONE_TEMPLATE.length;

/** Milestone induk (satu untuk paket) — locationId null saat materialisasi. */
export const PAKET_MILESTONES = ADMIN_MILESTONE_TEMPLATE.filter((t) => t.scope === "paket");
/** Milestone per lokasi — materialisasi per Location. */
export const LOKASI_MILESTONES = ADMIN_MILESTONE_TEMPLATE.filter((t) => t.scope === "lokasi");

/** Cari scope sebuah templateKey (default "paket"). */
export function milestoneScope(templateKey: string): MilestoneScope {
  return ADMIN_MILESTONE_TEMPLATE.find((t) => t.key === templateKey)?.scope ?? "paket";
}
