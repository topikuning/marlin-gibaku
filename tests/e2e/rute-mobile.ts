/**
 * DAFTAR RUTE YANG DISAPU PAGAR OVERFLOW MOBILE — satu sumber (DECISIONS 352).
 *
 * ### Kenapa berkas ini ada
 *
 * Teguran user 2026-08-17: *"lagi-lagi masalah tampilan mobile. kenapa harus
 * terjadi lagi"* — pertanyaan yang tepat, dan jawabannya bukan "kurang teliti".
 *
 * Pagar overflow (DECISIONS 217) menyapu DAFTAR RUTE YANG DITULIS TANGAN di
 * dalam spec-nya. Artinya setiap halaman baru lahir dalam keadaan TIDAK
 * TERJAGA, dan tidak ada apa pun yang memberi tahu. Saat keluhan ini datang,
 * aplikasi punya 60 halaman dan sapuannya menyentuh sekitar setengahnya —
 * termasuk melewatkan `/lokasi/[slug]/laporan-lokasi`, halaman yang dikeluhkan.
 *
 * Sekarang daftarnya dipindah ke sini dan dipasangkan `rute-terjaga.test.ts`:
 * uji itu membaca `src/app/(app)/**\/page.tsx` dan MENOLAK rute yang tidak ada
 * di salah satu daftar di bawah. Halaman baru memaksa keputusan sadar — disapu,
 * atau dikecualikan dengan alasan tertulis.
 */

/** Rute tanpa segmen dinamis — bisa dibuka apa adanya. */
export const RUTE_STATIS: { pola: string; nama: string }[] = [
  { pola: "/", nama: "Beranda / command center" },
  { pola: "/aktivitas", nama: "Dashboard eksekutif" },
  { pola: "/ai", nama: "AI Hub" },
  { pola: "/ai/actions", nama: "AI — tindakan" },
  { pola: "/ai/ask", nama: "AI — tanya" },
  { pola: "/ai/history", nama: "AI — riwayat run" },
  { pola: "/ai/reports", nama: "AI — laporan" },
  { pola: "/chat-grup", nama: "Chat grup" },
  { pola: "/chat-grup/global", nama: "Chat grup global" },
  { pola: "/dokumen", nama: "Dokumen" },
  { pola: "/dokumen/impor", nama: "Dokumen — impor" },
  { pola: "/dokumen/upload", nama: "Dokumen — unggah" },
  { pola: "/foto", nama: "Foto lapangan" },
  { pola: "/foto-cepat", nama: "Foto Cepat" },
  { pola: "/hari-ini", nama: "Hari Ini (mandor)" },
  { pola: "/keuangan", nama: "Keuangan" },
  { pola: "/kontak-wa", nama: "Kontak WhatsApp" },
  { pola: "/laporan", nama: "Laporan" },
  { pola: "/laporan-wa", nama: "Laporan WhatsApp" },
  { pola: "/laporan/status-harian", nama: "Status laporan harian" },
  { pola: "/lokasi", nama: "Daftar lokasi" },
  { pola: "/master", nama: "Master data" },
  { pola: "/master/kontak", nama: "Master — kontak" },
  { pola: "/master/kontak-wa", nama: "Master — kontak WhatsApp" },
  { pola: "/master/lokasi", nama: "Master — katalog lokasi" },
  { pola: "/master/pengguna", nama: "Master — pengguna" },
  { pola: "/master/perusahaan", nama: "Master — perusahaan" },
  { pola: "/paket", nama: "Daftar paket" },
  { pola: "/paket/baru", nama: "Paket baru" },
  { pola: "/paket/bypass", nama: "Paket bypass" },
  { pola: "/paket/katalog", nama: "Katalog paket" },
  { pola: "/paket/vendor", nama: "Vendor" },
  { pola: "/pengguna", nama: "Pengguna" },
  { pola: "/peta", nama: "Peta" },
  { pola: "/progress", nama: "Progress portofolio" },
  { pola: "/sistem", nama: "Sistem" },
  { pola: "/sistem/arsip-foto", nama: "Sistem — arsip foto" },
];

/**
 * Rute bersegmen dinamis. `isi` merakit URL nyata dari nilai yang ditemukan
 * saat uji berjalan; mengembalikan `null` berarti data uji tidak menyediakannya
 * dan rutenya dilewati (BUKAN dianggap lulus diam-diam — spec mencatatnya).
 */
export type KonteksRute = {
  slug: string | null;
  paketId: string | null;
  /** Tanggal laporan harian yang benar-benar ada, `YYYY-MM-DD`. */
  tanggal: string | null;
  dokumenId: string | null;
  fotoId: string | null;
  aiRunId: string | null;
  antrean: string | null;
};

export const RUTE_DINAMIS: {
  pola: string;
  nama: string;
  isi: (k: KonteksRute) => string[] | null;
}[] = [
  {
    pola: "/laporan/[antrean]",
    nama: "Antrean laporan",
    isi: () => ["/laporan/menunggu-verifikasi", "/laporan/perlu-koreksi"],
  },
  { pola: "/lokasi/[slug]", nama: "Workspace lokasi", isi: (k) => (k.slug ? [`/lokasi/${k.slug}`] : null) },
  {
    pola: "/lokasi/[slug]/harian",
    nama: "Pelaksanaan harian (kalender + daftar)",
    isi: (k) =>
      k.slug
        ? [
            `/lokasi/${k.slug}/harian`,
            `/lokasi/${k.slug}/harian?saring=perlu_tindakan`,
            `/lokasi/${k.slug}/harian?tampilan=daftar`,
            `/lokasi/${k.slug}/harian?bulan=2026-03`,
          ]
        : null,
  },
  {
    pola: "/lokasi/[slug]/harian/[date]",
    nama: "Isi laporan harian",
    isi: (k) => (k.slug && k.tanggal ? [`/lokasi/${k.slug}/harian/${k.tanggal}`] : null),
  },
  {
    pola: "/lokasi/[slug]/harian/import",
    nama: "Impor laporan harian",
    isi: (k) => (k.slug ? [`/lokasi/${k.slug}/harian/import`] : null),
  },
  {
    pola: "/lokasi/[slug]/laporan-lokasi",
    nama: "Laporan periodik KKP",
    /*
     * DUA keadaan, dan keduanya wajib. Halaman ini tampak aman saat dibuka
     * apa adanya — blanko KKP baru muncul SESUDAH "Tampilkan" (`show=1`).
     * Persis pola yang membuat cacat pita cuaca lolos di DECISIONS 230.
     */
    isi: (k) =>
      k.slug
        ? [
            `/lokasi/${k.slug}/laporan-lokasi`,
            `/lokasi/${k.slug}/laporan-lokasi?kind=mingguan&n=2&show=1`,
            `/lokasi/${k.slug}/laporan-lokasi?kind=bulanan&n=1&show=1`,
          ]
        : null,
  },
  { pola: "/lokasi/[slug]/dokumen", nama: "Dokumen lokasi", isi: (k) => (k.slug ? [`/lokasi/${k.slug}/dokumen`] : null) },
  { pola: "/lokasi/[slug]/kegiatan", nama: "Kegiatan lokasi", isi: (k) => (k.slug ? [`/lokasi/${k.slug}/kegiatan`] : null) },
  { pola: "/lokasi/[slug]/keuangan", nama: "Keuangan lokasi", isi: (k) => (k.slug ? [`/lokasi/${k.slug}/keuangan`] : null) },
  { pola: "/lokasi/[slug]/progress", nama: "Progress lokasi", isi: (k) => (k.slug ? [`/lokasi/${k.slug}/progress`] : null) },
  { pola: "/lokasi/[slug]/rab", nama: "RAB lokasi", isi: (k) => (k.slug ? [`/lokasi/${k.slug}/rab`] : null) },
  { pola: "/lokasi/[slug]/rab/adendum", nama: "Adendum RAB", isi: (k) => (k.slug ? [`/lokasi/${k.slug}/rab/adendum`] : null) },
  { pola: "/lokasi/[slug]/rab/import", nama: "Impor RAB", isi: (k) => (k.slug ? [`/lokasi/${k.slug}/rab/import`] : null) },
  { pola: "/lokasi/[slug]/rapl", nama: "RAPL lokasi", isi: (k) => (k.slug ? [`/lokasi/${k.slug}/rapl`] : null) },
  { pola: "/paket/[id]", nama: "Workspace paket", isi: (k) => (k.paketId ? [`/paket/${k.paketId}`] : null) },
  { pola: "/paket/[id]/aktivitas", nama: "Aktivitas paket", isi: (k) => (k.paketId ? [`/paket/${k.paketId}/aktivitas`] : null) },
  { pola: "/paket/[id]/dokumen", nama: "Dokumen paket", isi: (k) => (k.paketId ? [`/paket/${k.paketId}/dokumen`] : null) },
  { pola: "/paket/[id]/dokumen/impor", nama: "Impor dokumen paket", isi: (k) => (k.paketId ? [`/paket/${k.paketId}/dokumen/impor`] : null) },
  { pola: "/paket/[id]/kontrak", nama: "Kontrak paket", isi: (k) => (k.paketId ? [`/paket/${k.paketId}/kontrak`] : null) },
  { pola: "/paket/[id]/lokasi", nama: "Lokasi paket", isi: (k) => (k.paketId ? [`/paket/${k.paketId}/lokasi`] : null) },
  { pola: "/paket/[id]/tender", nama: "Tender paket", isi: (k) => (k.paketId ? [`/paket/${k.paketId}/tender`] : null) },
  { pola: "/dokumen/[id]", nama: "Detail dokumen", isi: (k) => (k.dokumenId ? [`/dokumen/${k.dokumenId}`] : null) },
  { pola: "/foto/[id]/cap", nama: "Cap foto", isi: (k) => (k.fotoId ? [`/foto/${k.fotoId}/cap`] : null) },
  { pola: "/ai/run/[id]", nama: "Detail run AI", isi: (k) => (k.aiRunId ? [`/ai/run/${k.aiRunId}`] : null) },
];

/**
 * Rute yang SENGAJA tidak disapu, beserta alasannya. Kosong berarti tidak ada
 * pengecualian — dan itu keadaan yang lebih disukai.
 *
 * Aturannya: alasan harus menyebut kenapa halaman ini tidak bisa diuji lebar,
 * bukan sekadar "belum sempat".
 */
export const DIKECUALIKAN: Record<string, string> = {};

/** Semua pola yang dianggap tercakup — dipakai `rute-terjaga.test.ts`. */
export function polaTercakup(): Set<string> {
  return new Set([
    ...RUTE_STATIS.map((r) => r.pola),
    ...RUTE_DINAMIS.map((r) => r.pola),
    ...Object.keys(DIKECUALIKAN),
  ]);
}

/**
 * Lebar yang disapu.
 *
 * DUA lebar, dan itu bukan berlebihan: cacat yang dikeluhkan 2026-08-17 TIDAK
 * ADA di 375px. Di layar sesempit itu deretan tombolnya membungkus sehingga
 * setiap menu mulai dari tepi kiri; baru di 414px dua tombol muat sebaris,
 * menu kedua mulai di x=264, dan panelnya 240px mendorong halaman jadi 504px.
 * Sapuan berlebar tunggal akan terus melewatkan seluruh keluarga cacat ini.
 */
export const LEBAR_SAPUAN = [375, 414] as const;
