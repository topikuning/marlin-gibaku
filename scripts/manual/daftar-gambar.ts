/**
 * DAFTAR GAMBAR buku manual — satu sumber kebenaran (DECISIONS 365).
 *
 * Buku manual MARLIN screenshot-nya DIBANGKITKAN, bukan dijepret tangan.
 * Alasannya bukan kerapian: UI-nya masih bergerak cepat — dalam satu hari saja
 * Master Data, Rencana & RAB, dan Progress dirombak (DECISIONS 359/362/363).
 * Buku yang gambarnya ditempel manual akan basi dalam hitungan minggu, dan
 * tidak ada yang tahu bagian mana yang sudah bohong.
 *
 * Berkas ini mendaftar SETIAP gambar: id-nya, siapa yang masuk, halaman mana,
 * dan lebar layar berapa. Naskah Markdown menyebut gambar lewat id itu, dan
 * `bangun.ts` MENOLAK membangun kalau ada yang tidak cocok — gambar yang
 * disebut naskah tapi tidak pernah dijepret, atau sebaliknya.
 */

/** Peran seed yang dipakai memotret. Password semuanya `marlin123`. */
export type PeranPotret = "admin" | "hery" | "pm-01" | "sm-01" | "mandor-01" | "kkp-viewer";

export type Gambar = {
  /** Dipakai di naskah sebagai `gambar/<id>.png`. Huruf kecil, tanda hubung. */
  id: string;
  /** Kalimat untuk pembaca — jadi caption di bawah gambar. WAJIB. */
  keterangan: string;
  peran: PeranPotret;
  /** Path relatif, boleh mengandung `{lokasi}` / `{paket}`. */
  path: string;
  /**
   * `ponsel` = 390×844 (ukuran HP lapangan), `layar` = 1280×900.
   *
   * Bab lapangan memakai ponsel karena di sanalah pekerjaannya benar-benar
   * dilakukan; memotret layar lebar untuk orang yang memegang HP membuat
   * bukunya tidak cocok dengan yang ia lihat.
   */
  lebar: "ponsel" | "layar";
  /** Potong hanya bagian ini (CSS selector) — mis. satu kartu, bukan seisi halaman. */
  potong?: string;
  /** Tunggu teks ini muncul sebelum menjepret; penjaga anti-halaman-setengah-jadi. */
  tunggu?: string;
  /** Gulir ke elemen ini dulu (untuk bagian yang jauh di bawah). */
  gulirKe?: string;
  /**
   * Dipotret TANPA sesi.
   *
   * Layar masuk hanya bisa dilihat oleh yang belum masuk — memotretnya sesudah
   * login menghasilkan halaman lain, karena MARLIN mengalihkan sesi yang sudah
   * sah. `peran` tetap diisi supaya pengelompokan tidak pincang, tapi tidak
   * dipakai.
   */
  tanpaSesi?: boolean;
};

/**
 * Bab LAPANGAN — Site Manager & Mandor.
 *
 * Semuanya ponsel. Urutannya mengikuti hari kerja, bukan struktur menu:
 * buka aplikasi → lihat tugas hari ini → isi laporan → kirim foto.
 */
export const GAMBAR_LAPANGAN: Gambar[] = [
  {
    id: "masuk",
    keterangan: "Layar masuk. Isi nama pengguna dan kata sandi yang diberikan admin.",
    peran: "sm-01",
    path: "/masuk",
    lebar: "ponsel",
    tanpaSesi: true,
  },
  {
    id: "hari-ini",
    keterangan:
      "Halaman Hari Ini — daftar pekerjaan yang perlu dilaporkan hari ini, langsung terbuka setelah masuk.",
    peran: "sm-01",
    path: "/hari-ini",
    lebar: "ponsel",
  },
  {
    id: "foto-cepat",
    keterangan:
      "Foto Cepat — jepret dulu, pilih itemnya belakangan. Dipakai saat sedang di lapangan dan tidak sempat mengisi apa pun.",
    peran: "sm-01",
    path: "/foto-cepat",
    lebar: "ponsel",
  },
  {
    id: "lokasi-ringkasan",
    keterangan: "Ringkasan satu lokasi: nilai kontrak, periode, rencana, realisasi, dan deviasi.",
    peran: "sm-01",
    path: "/lokasi/{lokasi}",
    lebar: "ponsel",
  },
  {
    id: "rencana-mingguan",
    keterangan:
      "Rencana Mingguan — target volume per pekerjaan untuk minggu berjalan, dibandingkan realisasi laporan harian.",
    peran: "sm-01",
    path: "/lokasi/{lokasi}/rab?bagian=rencana",
    lebar: "ponsel",
  },
];

/**
 * Bab MANAJEMEN — PM, Area Manager, Direktur.
 *
 * Layar lebar: angka-angka ini dibaca di kantor, dan tabel mingguan maupun
 * kurva-S memang tidak dimaksudkan dibaca di layar 390px.
 */
export const GAMBAR_MANAJEMEN: Gambar[] = [
  {
    id: "beranda",
    keterangan: "Beranda — ringkasan seluruh portofolio yang menjadi tanggung jawab Anda.",
    peran: "hery",
    path: "/",
    lebar: "layar",
  },
  {
    id: "progress-ringkasan",
    keterangan:
      "Progress sebuah lokasi: kurva-S di kiri, rencana vs realisasi per minggu di kanan, prognosa di bawahnya.",
    peran: "pm-01",
    path: "/lokasi/{lokasi}/progress?bagian=ringkasan",
    lebar: "layar",
  },
  {
    id: "progress-kendala",
    keterangan:
      "Tertinggal & Kendala — sepuluh item dengan nilai kekurangan terbesar, lalu catatan kendala dan aksi pemulihannya.",
    peran: "pm-01",
    path: "/lokasi/{lokasi}/progress?bagian=kendala",
    lebar: "layar",
  },
  {
    id: "perbarui-kurva-s",
    keterangan:
      "Alur Perbarui Kurva-S: lima langkah bernomor. Selama belum ditekan Terapkan, tidak ada satu pun angka resmi yang berubah.",
    peran: "pm-01",
    path: "/lokasi/{lokasi}/progress?bagian=baseline",
    lebar: "layar",
    potong: "section:has-text('Perbarui Kurva-S dari Excel')",
  },
];

export const SEMUA_GAMBAR: Gambar[] = [...GAMBAR_LAPANGAN, ...GAMBAR_MANAJEMEN];

/** Id ganda = satu gambar diam-diam menimpa yang lain. */
export function idGanda(daftar: Gambar[] = SEMUA_GAMBAR): string[] {
  const hitung = new Map<string, number>();
  for (const g of daftar) hitung.set(g.id, (hitung.get(g.id) ?? 0) + 1);
  return [...hitung].filter(([, n]) => n > 1).map(([id]) => id);
}
