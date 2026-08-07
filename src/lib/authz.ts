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
  // Foto Cepat: jepret/simpan foto DULU (koordinat + jam terekam saat itu),
  // itemnya dipilih belakangan. Dipisah dari daily_report.create karena justru
  // gunanya memotret TANPA harus punya laporan lebih dulu. DECISIONS 253.
  "photo.quick",
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

/**
 * JENJANG PERAN = SUPERSET (permintaan user 2026-08-02): "karena jenjang am di
 * atas pm, pm di atas sm, sm di atas pelaksana. harusnya semua yang dilakukan
 * di bawahnya bisa dilakukan atasnya."
 *
 * Karena itu tiap tingkat DISUSUN dari tingkat di bawahnya, bukan didaftar
 * ulang dari nol. Mendaftar ulang adalah cara paling mudah membuat atasan
 * kehilangan hak bawahannya tanpa ada yang sadar — persis yang terjadi sebelum
 * ini: Area Manager tidak bisa menyentuh laporan harian sama sekali, padahal
 * Site Manager di bawahnya bisa membuat, memverifikasi, DAN memfinalkan.
 *
 * Pemisahan tugas TIDAK dijaga di sini, melainkan di mesin transisi laporan
 * (setelan `daily_report.approver_must_differ`) — pagar berbasis ORANG, bukan
 * berbasis peran. Peran menjawab "boleh menyentuh apa"; pemisahan tugas
 * menjawab "tidak boleh mengesahkan pekerjaan sendiri". Dua soal berbeda;
 * mencampurnya membuat keduanya salah. DECISIONS 218.
 */
const PELAKSANA: Capability[] = [
  ...VIEW_ALL,
  "daily_report.create",
  "field_activity.manage",
  "photo.quick",
];

const SITE_MANAGER: Capability[] = [
  ...PELAKSANA,
  "package.view",
  "weekly_plan.manage",
  /**
   * ADENDUM: Site Manager ikut menyusun draft RAB adendum (DECISIONS 302).
   *
   * Sebelum ini SM tidak punya `rab.manage`, dan itu bertabrakan dengan
   * aturannya sendiri: `bolehMenyetujui()` (persetujuan empat mata, DECISIONS
   * 234) MENYEBUT Site Manager sebagai penyetuju yang sah — pesan galatnya
   * bahkan menuliskannya — padahal tombol setujunya ada di
   * `/lokasi/[slug]/rab/adendum`, halaman yang dijaga `rab.manage`. Jadi
   * sistem menjanjikan suara yang pintunya ia kunci sendiri: paket yang
   * mengandalkan pasangan Program Director + Site Manager TIDAK PERNAH bisa
   * mengaktifkan adendumnya, dan galatnya menyesatkan karena menyebut SM
   * berhak.
   *
   * Pilihan user 2026-08-07: beri SM `rab.manage` penuh. Konsekuensinya
   * disebut apa adanya — SM sekalian bisa mengedit RAB dan mengimpor HPS,
   * bukan sekadar ikut menyetujui. Yang TIDAK ikut terbuka: aktivasi revisi
   * tetap menuntut dua orang berbeda (satu di antaranya Program Director), dan
   * pencatatan adendum di sisi kontrak tetap `amendment.manage` (super_admin &
   * Program Director saja).
   */
  "rab.manage",
  "daily_report.review",
  "daily_report.finalize",
  "issue.manage",
  "finance.input",
  "document.upload",
  "report.export",
  "wa.chat",
  "user.create", // bikin Pelaksana di bawahnya
  "ai.view",
  "ai.generate",
  "ai.ask",
  // Pengganti exec_report.send yang dilebur (DECISIONS 193/194): SM tetap bisa
  // MENGIRIM ke WA, tapi kini hanya artefak yang sudah DIBEKUKAN atasannya —
  // bukan teks bebas hasil generate sendiri.
  "ai.report_send",
];

const PROJECT_MANAGER: Capability[] = [
  ...SITE_MANAGER,
  "portfolio.view",
  "location.manage",
  // `rab.manage` kini datang dari SITE_MANAGER (DECISIONS 302) — tidak
  // didaftar ulang di sini supaya jelas ia hak yang DIWARISI, bukan hak khas
  // Project Manager yang kebetulan sama namanya.
  "baseline.manage",
  "finance.view",
  "document.verify",
  "document.edit",
  "document.void",
  "compliance.manage",
  "ai.report_review",
];

const AREA_MANAGER: Capability[] = [
  ...PROJECT_MANAGER,
  // Yang KHAS Area Manager: mengesahkan, bukan menyusun. Dua ini sengaja tidak
  // dimiliki PM supaya penyusun dan pengesah tetap terpisah jenjang.
  "finance.approve",
  "ai.report_approve",
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
  regional_manager: new Set<Capability>(AREA_MANAGER),
  project_manager: new Set<Capability>(PROJECT_MANAGER),
  site_manager: new Set<Capability>(SITE_MANAGER),
  field_supervisor: new Set<Capability>(PELAKSANA),
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
  // Jenjang = superset juga di sini (DECISIONS 218): AM boleh membuat semua
  // yang boleh dibuat PM, ditambah PM itu sendiri.
  regional_manager: ["project_manager", "site_manager", "field_supervisor"],
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
