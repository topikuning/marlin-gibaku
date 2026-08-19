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
  /**
   * Potong hanya bagian ini — mis. satu kartu, bukan seisi halaman.
   *
   * String = satu elemen (CSS selector, boleh Playwright `:has-text`).
   * Array = GABUNGAN kotak pembungkus beberapa elemen sekaligus (dipotret
   * sebagai satu persegi yang mencakup semuanya) — dipakai saat yang perlu
   * ditunjukkan ada di DUA elemen bertetangga yang bukan satu leluhur bersama
   * yang rapi (mis. banner peringatan + form di bawahnya).
   *
   * Wajib dipakai untuk halaman ponsel yang isinya panjang (form + daftar item
   * + pelengkap KKP bisa 3-4 layar HP): screenshot SETINGGI ITU cetak jadi
   * gambar raksasa yang melintasi banyak halaman PDF dan meninggalkan halaman
   * sebelumnya kosong separuh (`figure { page-break-inside: avoid }` mendorong
   * seluruh gambar ke halaman berikutnya kalau tak muat di sisa halaman
   * berjalan) — lihat DECISIONS 368.
   */
  potong?: string | string[];
  /** Tunggu teks ini muncul sebelum menjepret; penjaga anti-halaman-setengah-jadi. */
  tunggu?: string;
  /** Gulir ke elemen ini dulu (untuk bagian yang jauh di bawah). */
  gulirKe?: string;
  /**
   * Alih-alih memotret `path` langsung: buka `path`, lalu IKUTI tautan pertama
   * yang teksnya cocok regex ini, dan potret halaman tujuannya.
   *
   * Dipakai saat URL sasaran tak bisa ditebak dari luar (mis. tanggal laporan
   * "perlu koreksi" — beda tiap kali `pnpm manual:seed` dijalankan). Tautannya
   * tetap diambil DARI APLIKASI (href sungguhan), bukan dihitung sendiri di
   * skrip ini — kalau seedingnya berubah dan tautannya hilang, penjepretnya
   * gagal keras, bukan diam-diam memotret halaman yang salah.
   */
  viaLinkText?: string;
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
    // Satu kartu lokasi saja (peran ini bisa ditugaskan ke lebih dari satu
    // lokasi — kartu kedua cuma mengulang bentuk yang sama, DECISIONS 368).
    potong: 'section:has-text("Purworejo")',
  },
  {
    id: "harian-isi",
    keterangan:
      "Mengisi laporan hari ini — pilih pekerjaan, isi volume yang selesai, lampirkan foto.",
    peran: "sm-01",
    path: "/lokasi/{lokasi}/harian/{hari}",
    lebar: "ponsel",
    tunggu: "Tambah / ubah progres pekerjaan",
    // Hanya form-nya — halaman penuh (form + daftar item + pelengkap KKP) bisa
    // 3-4 layar HP tinggi, jadi gambarnya raksasa dan halaman sebelumnya
    // kosong separuh saat dicetak (DECISIONS 368).
    potong: 'form:has-text("Tambah / ubah progres pekerjaan")',
  },
  {
    id: "harian-koreksi",
    keterangan:
      "Laporan yang dikembalikan SM untuk diperbaiki — alasannya tertulis jelas di sini, tinggal disunting sesuai catatan lalu dikirim ulang.",
    peran: "sm-01",
    path: "/hari-ini",
    viaLinkText: "Perbaiki laporan",
    lebar: "ponsel",
    tunggu: "Laporan dikembalikan",
    // Banner peringatan + form di bawahnya — bukan satu leluhur yang rapi,
    // jadi digabung lewat DUA selector (lihat catatan `potong` di atas).
    potong: ['[role="status"]:has-text("Laporan dikembalikan")', 'form:has-text("Tambah / ubah progres pekerjaan")'],
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
    tunggu: "Kurva-S",
    // Sampai kurva-S saja — Rencana minggu/Kendala/Status lokasi di bawahnya
    // sudah ada gambar sendiri-sendiri, tak perlu diulang di sini (DECISIONS 368).
    potong: ["@awal", 'section:has-text("Kurva-S")'],
  },
  {
    id: "rencana-mingguan",
    keterangan:
      "Rencana Mingguan — target volume per pekerjaan untuk minggu berjalan, dibandingkan realisasi laporan harian.",
    peran: "sm-01",
    path: "/lokasi/{lokasi}/rab?bagian=rencana",
    lebar: "ponsel",
    tunggu: "Saran otomatis",
    // Sampai kartu "Saran otomatis" — form tambah rencana + daftar item di
    // bawahnya bukan inti cerita layar ini (DECISIONS 368).
    potong: ["@awal", 'button:has-text("Sarankan otomatis")'],
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
