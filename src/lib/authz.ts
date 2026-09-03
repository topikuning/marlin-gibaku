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
  // Mode periode minggu laporan SAJA. Dipisah dari `contract.edit` supaya bisa
  // diberikan tanpa ikut membuka nomor/nilai/PPN/tanggal kontrak (DECISIONS 507).
  "contract.week_mode",
  "amendment.manage",
  "location.view",
  "location.manage",
  // Koreksi susunan lokasi paket BERKONTRAK (lokasi ketinggalan saat input) —
  // super_admin SAJA, bukan adendum. DECISIONS 187.
  "location.correct",
  // Isi nama & unggah coretan tanda tangan PENANDA TANGAN LOKASI (pelaksana +
  // pengawas lokasi itu) — Site Manager ke atas. SENGAJA dipisah dari
  // `location.manage`, yang ikut membawa ganti nama lokasi & ubah koordinat
  // master (dipakai cap foto). DECISIONS 419.
  "location.signer",
  "rab.view",
  "rab.manage",
  /*
   * RAPL — rencana anggaran PELAKSANAAN: harga satuan dasar, biaya per item,
   * dan margin terhadap nilai RAB.
   *
   * Sengaja BUKAN `finance.*`. Keduanya memang uang, tapi bukan uang yang sama
   * dan bukan pintu yang sama: `finance.*` adalah menu Keuangan (komitmen,
   * invoice, pengeluaran) yang sampai sekarang ditahan karena layarnya belum
   * siap, sedangkan RAPL adalah perencanaan biaya yang menempel pada RAB dan
   * sudah dipakai. Meminjam `finance.*` untuk RAPL — yang sempat terjadi —
   * membuat penahanan satu menu diam-diam mematikan fitur di menu lain.
   * Keputusan user 2026-08-29.
   *
   * Pembagiannya (pilihan user pada tanggal yang sama):
   * - `rapl.view` mulai Project Manager — MARGIN adalah angka menawar, dan
   *   berhenti di kantor.
   * - `rapl.manage` mulai Site Manager — yang paling tahu harga bahan di
   *   lapangan memang orang lapangan, jadi ia mengisi HSD & rincian meski
   *   kolom marginnya tidak ia lihat.
   * Kebutuhan volume bahan/upah/alat TIDAK di sini: ia tetap `rab.view`.
   */
  "rapl.view",
  "rapl.manage",
  "baseline.manage",
  "weekly_plan.manage",
  "daily_report.create",
  "daily_report.review",
  "daily_report.finalize",
  // Buka kunci laporan final untuk koreksi — super_admin SAJA (DECISIONS 149).
  "daily_report.unfinalize",
  // Pindahkan laporan ke tanggal lain (salah input tanggal) — super_admin SAJA
  // (permintaan user 2026-08-22, DECISIONS 415). Menggeser tanggal berarti
  // menggeser volume ke hari lain: kurva-S, deviasi, dan angka kumulatif
  // laporan di antaranya ikut berubah. Karena itu setara membuka laporan final,
  // bukan setara mengedit isi.
  "daily_report.move_date",
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
  // Tautan KELUAR ke folder Google Drive vendor ("Lihat di Drive") — super_admin
  // SAJA (permintaan user 2026-08-22). Di seberang tautan itu tidak ada lagi
  // pembatasan lokasi yang berlaku di MARLIN, dan bagi orang lapangan ia tidak
  // menambah apa pun: keadaan "sudah ke Drive" sudah terbaca dari lencananya.
  // Ini kemampuan MELIHAT TAUTAN, bukan mengunggah — unggahannya tetap
  // `report.export`.
  "gdrive.open_folder",
  "progress.view",
  "issue.manage",
  /*
   * PENGENDALIAN TERPADU — temuan, inspeksi, verifikasi eksternal
   * (DECISIONS 426). Pemisahan tugasnya berbasis PERAN dan disengaja:
   * pihak pelaksana (SM/PM/AM) TIDAK memegang `finding.verify` — yang menutup
   * temuan bukan yang ditindak; pemeriksa (wakil_ppk) TIDAK memegang
   * `finding.respond` — pemeriksa tidak menindaklanjuti temuannya sendiri.
   * SA/PD memegang keduanya sebagai break-glass yang selalu ter-audit.
   */
  "finding.view",
  "finding.create",
  "finding.respond",
  "finding.verify",
  "inspection.manage",
  // Verifikasi EKSTERNAL laporan harian (jejak pemeriksaan wakil pemberi
  // kerja). TIDAK mengubah status laporan & TIDAK menyentuh angka resmi.
  "report.verify_external",
  /*
   * KEUANGAN DITAHAN: SEMENTARA super_admin saja (permintaan user 2026-08-22).
   *
   * *"menu keuangan saat ini belum siap, jadi selain superadmin, tidak usah
   * ditampilkan dulu."*
   *
   * Ditahan di CAPABILITY, bukan sekadar disembunyikan dari menu. Menyembunyikan
   * menu saja meninggalkan alamatnya terbuka — siapa pun yang pernah membuka
   * /keuangan atau menyimpan tautannya tetap masuk, dan fitur yang "belum siap"
   * akan tetap ditemukan orang. Di sini pintunya yang ditutup; menunya hilang
   * dengan sendirinya karena nav memang menyaring dengan capability.
   *
   * YANG DITAHAN HANYA MENU KEUANGAN ITU SENDIRI — komitmen, invoice,
   * pengeluaran, dan adapter AI yang membacanya. Penegasan user 2026-08-29:
   * *"yang kumaksud dari awal bahwa hanya superadmin yg bisa melihat keuangan
   * itu, maksudnya tab keuangan, yang mana itu masih mentah. bukan membatasi
   * fitur-fitur keuangan yang berhubungan dengan menu lain"*. Karena itu
   * capability ini TIDAK boleh dipinjam layar lain yang kebetulan menampilkan
   * uang; RAPL punya `rapl.view`/`rapl.manage` sendiri di atas. Kalau nanti ada
   * layar uang baru di luar menu Keuangan, ia juga perlu pintunya sendiri —
   * bukan menumpang di sini.
   *
   * CARA MEMBUKANYA KEMBALI: hapus `!c.startsWith("finance.")` pada penyaring
   * program_director di bawah, lalu kembalikan `finance.input` ke SITE_MANAGER,
   * `finance.view` ke PROJECT_MANAGER + exec_viewer, dan `finance.approve` ke
   * AREA_MANAGER. Empat tempat, sengaja ditulis di sini supaya pemulihannya
   * tidak jadi pekerjaan menebak.
   */
  "finance.view",
  "finance.input",
  "finance.approve",
  "document.view",
  "document.upload",
  // Register surat masuk/keluar + antrean lampiran WA (DECISIONS 432).
  "letter.view",
  "letter.manage",
  // Batalkan / pulihkan surat: hilang dari daftar & hitungan, barisnya tetap
  // ada lengkap dengan sebab & pembatalnya (DECISIONS 437). Sengaja SATU
  // jenjang dengan letter.manage: yang mencatat surat itulah yang salah ketik,
  // dan pembatalannya reversibel + ber-jejak audit. TIDAK ADA hapus permanen.
  "letter.void",
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
  // Papan temuan terbuka untuk semua yang boleh melihat lokasi — temuan yang
  // disembunyikan dari pelaksananya sendiri tidak akan pernah ditindaklanjuti.
  "finding.view",
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
  // Mengisi HSD & rincian pelaksanaan RAPL. Melihat marginnya TIDAK ikut —
  // itu `rapl.view`, mulai Project Manager.
  "rapl.manage",
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
  /**
   * KURVA-S: Site Manager boleh mengubah baseline (DECISIONS 353).
   *
   * Keputusan user 2026-08-17, menjawab pertanyaannya sendiri "siapa yang boleh
   * mengubah kurva S?".
   *
   * Susunan sebelumnya tidak konsisten dengan DECISIONS 302: SM sudah memegang
   * `rab.manage` — ia boleh mengubah BOBOT, yaitu bahan baku kurvanya — tapi
   * tidak boleh menyentuh jadwalnya. Padahal SM pula yang memegang jadwal
   * lapangan dan yang ditanya ketika realisasi menyimpang dari rencana. Ia
   * harus meminta atasan untuk menyesuaikan kurva atas pekerjaan yang dia
   * sendiri kelola.
   *
   * Yang membatasi tetap ada dan tidak diubah:
   *
   *  - `requireLocationAccess` di SETIAP aksi baseline — SM hanya bisa
   *    menyentuh lokasi penugasannya, bukan seluruh paket;
   *  - baseline append-only: versi lama tidak ditimpa, hanya "digantikan", dan
   *    seluruh riwayatnya tetap bisa dibuka & dipulihkan;
   *  - deret manual divalidasi ulang di server (monoton, 0..100, berakhir 100);
   *  - tanggal kontrak — kisi mingguan kurvanya — tetap `contract.manage`
   *    (super_admin & Program Director saja).
   *
   * Jadi yang terbuka adalah MENYUSUN ULANG rencana dalam kontrak yang sudah
   * ditetapkan, bukan mengubah kontraknya, dan bukan menghapus jejak.
   */
  "baseline.manage",
  "daily_report.review",
  "daily_report.finalize",
  /**
   * PENANDA TANGAN LOKASI: Site Manager boleh mengisinya (DECISIONS 419).
   *
   * Permintaan user 2026-08-23 *"untuk pengisian nama penandatangan site
   * manager dijinkan"*. Yang dibuka HANYA penimpaan per-lokasi — nama+jabatan
   * Pelaksana Lapangan dan nama+firma Konsultan Pengawas lokasi itu, berikut
   * coretan tanda tangannya. Penanda tangan tingkat PAKET (PPK, Direktur,
   * pengawas kontrak) tetap `contract.manage`: satu orang mengubahnya di sana,
   * seluruh lokasi paket ikut berubah.
   *
   * Kapabilitas sendiri, bukan `location.manage`, karena yang diminta adalah
   * mengisi nama — bukan mengganti nama lokasi dan bukan menggeser koordinat
   * master yang dipakai cap foto sebagai bukti titik.
   */
  "location.signer",
  "issue.manage",
  // Temuan (DECISIONS 426): SM boleh MENCATAT temuan (QA internal) dan
  // MENINDAKLANJUTI temuan yang dialamatkan padanya — tapi TIDAK memverifikasi
  // penutupan (lihat catatan pemisahan tugas di daftar capability).
  "finding.create",
  "finding.respond",
  "document.upload",
  // Register surat: SM ke atas. Pelaksana tidak dilibatkan — korespondensi
  // resmi bukan pekerjaannya, dan daftar surat memuat hal yang tidak perlu
  // dibaca seluruh lapangan.
  "letter.view",
  "letter.manage",
  "letter.void",
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
  // Biaya & margin RAPL. Mengisinya sudah diwarisi dari SITE_MANAGER.
  "rapl.view",
  /**
   * KONTRAK NORMAL: Project Manager (dan karenanya Area Manager) mengurus
   * kontraknya sendiri (DECISIONS 421).
   *
   * Permintaan user 2026-08-23: *"project manager dan area manager bisa
   * melakukan semua hal yang berhubungan dengan kontrak normal, isi penanda
   * tangan, ajukan adendum, isi logo, dsb"*.
   *
   * Yang ikut terbuka bersama `contract.manage` — disebut apa adanya, bukan
   * diam-diam: input data kontrak (convertToContract), nama penanda tangan,
   * gambar tanda tangan & stempel, memulai pelaksanaan, membuat vendor, serta
   * master Perusahaan termasuk logo/kop/stempel vendor.
   *
   * Yang TETAP super_admin, dan sengaja: `contract.edit` — KOREKSI kontrak yang
   * sudah berjalan (nomor, nilai, PPN, tanggal). Itu bukan pekerjaan kontrak
   * normal melainkan pembetulan data yang menggeser kisi mingguan kurva-S dan
   * dasar semua angka deviasi; sama alasannya dengan `location.correct`.
   */
  "contract.manage",
  /**
   * MODE PERIODE MINGGU laporan — permintaan user 2026-09-03: *"project manager
   * diijinkan untuk ubah periode minggu laporan."*
   *
   * Diberikan sebagai kapabilitas TERSENDIRI, bukan dengan membuka
   * `contract.edit`. `contract.edit` memuat nomor, NILAI KONTRAK, PPN, tanggal
   * TTD, SPMK, dan masa pelaksanaan; membukanya demi satu dropdown berarti
   * memberi enam hal yang tidak diminta.
   *
   * Yang ikut jadi konsekuensinya, dan disebut apa adanya: mengganti mode
   * minggu MENGKONVERSI baseline & jadwal seluruh lokasi paket ke grid tanggal
   * baru. Itu memang inti fiturnya (DECISIONS 427d), bukan efek samping — tapi
   * artinya PM kini bisa menggeser peta tanggal M1–MN yang jadi dasar semua
   * angka deviasi paketnya.
   */
  "contract.week_mode",
  "amendment.manage",
  // `rab.manage` (DECISIONS 302) dan `baseline.manage` (DECISIONS 353) kini
  // datang dari SITE_MANAGER — tidak didaftar ulang di sini supaya jelas
  // keduanya hak yang DIWARISI, bukan hak khas Project Manager yang kebetulan
  // sama namanya. Mendaftarnya dua kali membuat pencabutan di SM kelak tidak
  // terlihat efeknya di PM, dan itu cara matriks izin diam-diam jadi bohong.
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
  "ai.report_approve",
];

export const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<Capability>> = {
  super_admin: new Set<Capability>(CAPABILITIES),
  program_director: new Set<Capability>(
    // contract.edit = koreksi data kontrak, khusus super_admin.
    // wa.configure (set grup WhatsApp paket) sementara khusus super_admin juga.
    // daily_report.unfinalize = membuka laporan yang sudah final, super_admin saja.
    // daily_report.move_date = memindahkan laporan ke tanggal lain, super_admin saja.
    // contact.view_all = melihat kontak milik akun lain, super_admin saja.
    // document.delete = hapus permanen dokumen, super_admin saja (batalkan cukup).
    // gdrive.open_folder = tautan keluar ke folder Drive vendor, super_admin saja.
    // finance.* = SEMENTARA super_admin saja — lihat catatan di bawah.
    CAPABILITIES.filter(
      (c) =>
        !c.startsWith("finance.") &&
        c !== "system.manage" &&
        c !== "contract.edit" &&
        c !== "wa.configure" &&
        c !== "daily_report.unfinalize" &&
        c !== "daily_report.move_date" &&
        c !== "contact.view_all" &&
        c !== "document.delete" &&
        c !== "gdrive.open_folder" &&
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
    "report.export",
    // Biaya & margin RAPL, TANPA `rapl.manage`: peran ini membaca, tidak
    // mengisi. Margin justru angka yang paling dicari eksekutif.
    "rapl.view",
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
  /**
   * DECISIONS 426 memperluas peran ini dari BACA SAJA menjadi VERIFIKATOR
   * (prompt user 2026-08-24: workspace Wakil PPK dengan inspeksi, verifikasi
   * laporan & evidence, temuan, klarifikasi). Menggantikan sebagian
   * DECISIONS 199. Yang TIDAK berubah: tanpa `ai.*`, tanpa `finance.*`,
   * tanpa satu pun capability yang mengubah data PELAKSANA (laporan, RAB,
   * dokumen, keuangan), dan tetap sesuai penugasan lokasi.
   */
  wakil_ppk: new Set<Capability>([
    ...VIEW_ALL,
    "portfolio.view",
    "package.view",
    "report.export",
    "finding.create",
    "finding.verify",
    "inspection.manage",
    "report.verify_external",
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
