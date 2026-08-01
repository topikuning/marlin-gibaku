import type { UserRole } from "@/generated/prisma/enums";

/**
 * Otorisasi capability-based. Sumber: docs/rebuild/PERMISSION_MATRIX.md.
 * Frontend hanya menyembunyikan menu; setiap Server Action / Route Handler
 * WAJIB memanggil requireCapability / requireLocationAccess lagi.
 */

export const CAPABILITIES = [
  "portfolio.view",
  "package.view",
  "package.create",
  "package.edit",
  "package.bypass",
  "prospect.manage",
  "contract.manage",
  "contract.edit", // koreksi kontrak (super_admin saja) — beda dari adendum
  "amendment.manage",
  "location.view",
  "location.manage",
  // Koreksi susunan lokasi paket BERKONTRAK (lokasi ketinggalan saat input) —
  // super_admin SAJA, bukan adendum. DECISIONS 187.
  "location.correct",
  "rab.view",
  "rab.manage",
  "baseline.manage",
  "weekly_plan.manage",
  "daily_report.create",
  "daily_report.review",
  "daily_report.finalize",
  // Buka kunci laporan final untuk koreksi — super_admin SAJA (DECISIONS 149).
  "daily_report.unfinalize",
  "field_activity.manage",
  // Perbaiki cap foto dari berkas ASLI yang diarsipkan — SA + PD (DECISIONS 198).
  // Cap dibakar ke gambar, jadi ini menulis ulang bukti: butuh alasan + riwayat.
  "photo.restamp",
  // Hapus arsip berkas asli (melegakan penyimpanan). Setelah dihapus, cap foto
  // itu TIDAK bisa diperbaiki lagi — karena itu terpisah dari photo.restamp.
  "photo.archive_purge",
  "wa.configure", // atur grup WhatsApp per paket + tes koneksi WAHA (sementara super_admin saja)
  "progress.view",
  "issue.manage",
  "finance.view",
  "finance.input",
  "finance.approve",
  "document.view",
  "document.upload",
  "document.verify",
  // Koreksi metadata dokumen (jenis/fase/nomor/tanggal/tautan) — salah unggah
  // dulu menetap selamanya. DECISIONS 183.
  "document.edit",
  // Batalkan / pulihkan dokumen: hilang dari daftar & tidak lagi jadi bukti
  // milestone, file + jejak audit tetap utuh (reversibel).
  "document.void",
  // Hapus permanen (file R2 + baris DB) — super_admin SAJA, dan hanya untuk
  // dokumen yang sudah dibatalkan.
  "document.delete",
  "compliance.manage",
  "report.export",
  // Workspace Chat Grup + kelola kontak tujuan WA milik sendiri — site_manager
  // ke atas. (Dulu bernama exec_report.send; menu Laporan → WA-nya sendiri
  // sudah dilebur ke Report Studio, DECISIONS 193/194.)
  "wa.chat",
  // Lihat & kelola kontak tujuan WA milik SEMUA akun — super_admin SAJA
  // (DECISIONS 150). Tanpa ini setiap akun hanya melihat kontaknya sendiri.
  "contact.view_all",
  // AI Intelligence Hub (DECISIONS 133) — AI = penjelas, bukan sumber angka.
  "ai.view", // buka hub + riwayat run
  "ai.generate", // jalankan analisis (pulse/deviasi/risiko/kualitas) + draf laporan + saran
  "ai.ask", // Ask MARLIN (tanya-jawab grounded, read-only)
  "ai.report_review", // review/edit draf laporan AI
  "ai.report_approve", // approve + freeze artefak laporan
  "ai.report_send", // distribusi artefak beku (WA)
  "user.manage",
  "user.create",
  "system.manage",
  "audit.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const VIEW_ALL: Capability[] = [
  "location.view",
  "rab.view",
  "progress.view",
  "document.view",
];

export const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<Capability>> = {
  super_admin: new Set<Capability>(CAPABILITIES),
  program_director: new Set<Capability>(
    // contract.edit = koreksi data kontrak, khusus super_admin.
    // wa.configure (set grup WhatsApp paket) sementara khusus super_admin juga.
    // daily_report.unfinalize = membuka laporan yang sudah final, super_admin saja.
    // contact.view_all = melihat kontak milik akun lain, super_admin saja.
    // document.delete = hapus permanen dokumen, super_admin saja (batalkan cukup).
    CAPABILITIES.filter(
      (c) =>
        c !== "system.manage" &&
        c !== "contract.edit" &&
        c !== "wa.configure" &&
        c !== "daily_report.unfinalize" &&
        c !== "contact.view_all" &&
        c !== "document.delete" &&
        c !== "location.correct",
    ),
  ),
  regional_manager: new Set<Capability>([
    ...VIEW_ALL,
    "portfolio.view",
    "package.view",
    "location.manage",
    "weekly_plan.manage",
    "issue.manage",
    "field_activity.manage",
    "finance.view",
    "finance.approve",
    "document.upload",
    "document.verify",
    "document.edit",
    "document.void",
    "compliance.manage",
    "report.export",
    "wa.chat",
    "ai.view",
    "ai.generate",
    "ai.ask",
    "ai.report_review",
    "ai.report_approve",
    "ai.report_send",
  ]),
  project_manager: new Set<Capability>([
    ...VIEW_ALL,
    "portfolio.view",
    "package.view",
    "location.manage",
    "rab.manage",
    "baseline.manage",
    "weekly_plan.manage",
    "daily_report.review",
    "field_activity.manage",
    "issue.manage",
    "finance.view",
    "finance.input",
    "document.upload",
    "document.verify",
    "document.edit",
    "document.void",
    "compliance.manage",
    "report.export",
    "wa.chat",
    "user.create", // bikin Site Manager & Pelaksana di bawahnya
    "ai.view",
    "ai.generate",
    "ai.ask",
    "ai.report_review",
    "ai.report_send",
  ]),
  site_manager: new Set<Capability>([
    ...VIEW_ALL,
    "package.view",
    "weekly_plan.manage",
    "daily_report.create",
    "daily_report.review",
    "daily_report.finalize",
    "field_activity.manage",
    "issue.manage",
    "finance.input",
    "document.upload",
    "report.export",
    "wa.chat",
    "user.create", // bikin Pelaksana di bawahnya
    "ai.view",
    "ai.generate",
    "ai.ask",
    // Pengganti exec_report.send yang dilebur (DECISIONS 193/194): SM tetap
    // bisa MENGIRIM ke WA, tapi kini hanya artefak yang sudah DIBEKUKAN
    // atasannya — bukan teks bebas hasil generate sendiri.
    "ai.report_send",
  ]),
  field_supervisor: new Set<Capability>([
    ...VIEW_ALL,
    "daily_report.create",
    "field_activity.manage",
  ]),
  exec_viewer: new Set<Capability>([
    ...VIEW_ALL,
    "portfolio.view",
    "package.view",
    "finance.view",
    "report.export",
    "ai.view",
    "ai.generate",
    "ai.ask",
  ]),
  /**
   * Wakil PPK — wakil pemberi kerja (DECISIONS 199). BACA SAJA, tanpa satu pun
   * capability yang mengubah data, dan SENGAJA tanpa `ai.*`: narasi AI tidak
   * boleh sampai ke pemberi kerja sebagai kesimpulan MARLIN.
   *
   * `finance.view` juga TIDAK diberikan: menu Keuangan di sini adalah uang
   * INTERNAL pelaksana (komitmen, invoice, pengeluaran) — bukan urusan pemberi
   * kerja. Nilai kontrak & termin tetap terlihat lewat halaman Paket/Kontrak.
   *
   * Bukan CROSS_LOCATION_ROLES: hanya lokasi yang ditugaskan (permintaan user
   * "sesuai penugasan juga"). Tanpa penugasan → NOL lokasi, gagal ke arah aman.
   */
  wakil_ppk: new Set<Capability>([
    ...VIEW_ALL,
    "portfolio.view",
    "package.view",
    "report.export",
  ]),
};

/**
 * Role yang melihat semua lokasi ORGANISASI tanpa penugasan.
 *
 * `exec_viewer` SENGAJA tidak di sini (DECISIONS 190, permintaan user
 * 2026-07-31): Executive View pun harus ditugaskan lokasi. Akun exec tanpa
 * penugasan melihat NOL lokasi — lupa menugaskan gagal ke arah aman, bukan
 * diam-diam membuka seluruh portofolio. Untuk exec tingkat nasional, tugaskan
 * seluruh lokasi ke akunnya.
 */
export const CROSS_LOCATION_ROLES: ReadonlySet<UserRole> = new Set([
  "super_admin",
  "program_director",
]);

export function can(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function isCrossLocation(role: UserRole): boolean {
  return CROSS_LOCATION_ROLES.has(role);
}

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super Admin",
  program_director: "Program Director",
  regional_manager: "Area Manager",
  project_manager: "Project Manager",
  site_manager: "Site Manager",
  field_supervisor: "Pelaksana",
  exec_viewer: "Executive View",
  wakil_ppk: "Wakil PPK",
};

export const ALL_ROLES = Object.keys(ROLE_LABEL) as UserRole[];

/**
 * Pembuatan user BERJENJANG: siapa boleh membuat akun peran apa.
 * PM boleh bikin Site Manager & Pelaksana; Site Manager boleh bikin Pelaksana.
 * Peran manajemen penuh (super_admin/program_director) boleh membuat semua.
 * Selalu dicatat createdById agar tahu pembuatnya.
 */
const ROLE_CREATE_MATRIX: Partial<Record<UserRole, UserRole[]>> = {
  super_admin: ALL_ROLES,
  program_director: ALL_ROLES.filter((r) => r !== "super_admin"),
  project_manager: ["site_manager", "field_supervisor"],
  site_manager: ["field_supervisor"],
};

/**
 * Peringkat peran — angka KECIL = lebih tinggi. Dipakai proteksi akun: seorang
 * admin tidak boleh mereset password atau menonaktifkan akun yang setingkat
 * atau lebih tinggi darinya, supaya satu akun yang bocor tidak bisa mengambil
 * alih seluruh sistem (DECISIONS 165).
 */
const ROLE_RANK: Record<UserRole, number> = {
  super_admin: 0,
  program_director: 1,
  regional_manager: 2,
  project_manager: 3,
  site_manager: 4,
  field_supervisor: 5,
  exec_viewer: 6,
  wakil_ppk: 6,
};

/** `actor` berperingkat lebih tinggi daripada `target` (bukan setingkat). */
export function outranks(actor: UserRole, target: UserRole): boolean {
  return ROLE_RANK[actor] < ROLE_RANK[target];
}

/** Peran yang boleh mengelola akun — dasar proteksi "admin aktif terakhir". */
export const ADMIN_ROLES: UserRole[] = ALL_ROLES.filter((r) => can(r, "user.manage"));

/** Daftar peran yang boleh dibuat oleh `role` (kosong = tidak boleh membuat user). */
export function creatableRoles(role: UserRole): UserRole[] {
  return ROLE_CREATE_MATRIX[role] ?? [];
}

/** Apakah `actorRole` boleh membuat akun ber-peran `targetRole`. */
export function canCreateRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return creatableRoles(actorRole).includes(targetRole);
}
