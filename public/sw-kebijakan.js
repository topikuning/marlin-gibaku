/**
 * KEBIJAKAN SERVICE WORKER MARLIN — bagian MURNI, yang diuji (DECISIONS 397).
 *
 * Dipisah dari `sw.js` supaya keputusan "permintaan mana yang boleh disimpan"
 * bisa diuji vitest, bukan sekadar dipercaya. Service worker adalah satu-satunya
 * kode di aplikasi ini yang bisa menyajikan JAWABAN LAMA sebagai jawaban baru;
 * salah satu baris di sini berarti mandor melihat data orang lain atau data
 * kemarin tanpa tahu.
 *
 * Skrip KLASIK (bukan modul ESM) dan dimuat lewat importScripts(): service
 * worker bertipe modul baru ada di Chrome 91+, sedangkan ponsel lapangan justru
 * yang paling tua. Ujinya membaca berkas ini lalu menjalankannya di lingkup
 * palsu — lihat tests/unit/sw-kebijakan.test.ts.
 */
(function (lingkup) {
  "use strict";

  /**
   * Naikkan saat bentuk isi cache berubah (bukan tiap deploy — aset ber-hash
   * dibersihkan lewat penanda build, lihat `sw.js`).
   */
  var VERSI = "1";

  var NAMA = {
    /** Kerangka luring: halaman /offline + ikon + aset yang dirujuknya. */
    kerangka: "marlin-kerangka-" + VERSI,
    /** Aset build ber-hash (/_next/static) + ikon brand. */
    aset: "marlin-aset-" + VERSI,
    /** HTML halaman ber-sesi yang sengaja disimpan (daftar putih di bawah). */
    halaman: "marlin-halaman-" + VERSI,
  };

  var AWALAN = "marlin-";
  var HALAMAN_OFFLINE = "/offline";
  var KUNCI_META = "/__marlin-sw-meta";
  var CAP_SIMPAN = "x-marlin-disimpan";

  /**
   * SATU-SATUNYA rute yang HTML-nya disimpan di perangkat.
   *
   * Foto Cepat saja, dan itu keputusan sadar. Halaman ini punya alasan khusus:
   * ia satu-satunya yang MASIH BISA DIPAKAI tanpa jaringan — jepretannya masuk
   * antrean IndexedDB dan terkirim belakangan (DECISIONS 257). Halaman lain
   * kalau disimpan hanya jadi gambar data basi yang tidak bisa ditindaklanjuti,
   * sambil menambah risiko HTML ber-sesi tertinggal di HP.
   */
  var RUTE_LURING = ["/foto-cepat"];

  /** Selalu dijemput saat pemasangan supaya kerangka luring ada sebelum dibutuhkan. */
  var PRAPASANG = [
    HALAMAN_OFFLINE,
    "/brand/marlin-favicon-192.png",
    "/brand/marlin-favicon-512.png",
  ];

  /**
   * Rencana penanganan satu permintaan.
   *
   * - `lewati`          : service worker TIDAK menyentuhnya sama sekali.
   * - `aset-statis`     : simpanan dulu, lalu jaringan (berkas ber-hash, kekal).
   * - `navigasi-luring` : jaringan dulu; berhasil = disimpan, gagal = sajikan simpanan.
   * - `navigasi-biasa`  : jaringan dulu; gagal = halaman /offline. Tidak pernah disimpan.
   *
   * @param {{metode: string, url: string, asal: string, mode?: string, rsc?: boolean}} p
   * @returns {"lewati"|"aset-statis"|"navigasi-luring"|"navigasi-biasa"}
   */
  function rencana(p) {
    // Non-GET = server action, unggah foto, login. Mengintipnya saja sudah
    // salah: antrean foto (DECISIONS 257) bergantung pada jawaban server yang
    // APA ADANYA untuk memutuskan "dicoba lagi selamanya" vs "berhenti".
    if (p.metode !== "GET") return "lewati";

    var u;
    try {
      u = new URL(p.url);
    } catch (_) {
      return "lewati";
    }
    // R2, tile peta, apa pun di luar asal ini: bukan urusan kita.
    if (u.origin !== p.asal) return "lewati";

    // Muatan RSC (navigasi sisi-klien & prefetch Next) BUKAN dokumen. Menjawabnya
    // dengan HTML tersimpan membuat router menelan sampah; biarkan gagal apa
    // adanya supaya Next jatuh ke navigasi penuh yang memang kita tangani.
    if (p.rsc) return "lewati";

    var jalur = u.pathname;

    // /api/** — kesehatan, PDF, foto asli, webhook. Semuanya data hidup atau
    // berkas besar; tidak satu pun benar kalau dijawab dari simpanan.
    if (jalur.indexOf("/api/") === 0) return "lewati";

    // Ber-hash isi (aset build) atau ikon aplikasi: aman disimpan selamanya,
    // sebab nama berkasnya berubah begitu isinya berubah.
    if (jalur.indexOf("/_next/static/") === 0 || jalur.indexOf("/brand/") === 0) {
      return "aset-statis";
    }

    if (p.mode !== "navigate") return "lewati";

    // Query berarti halaman yang BERBEDA isinya (saringan, tanggal, tab).
    // Menyimpannya di bawah satu kunci berarti menyajikan halaman yang salah;
    // menyimpan per-query berarti simpanan tak berbatas. Keduanya ditolak.
    if (u.search) return "navigasi-biasa";

    return RUTE_LURING.indexOf(jalur) >= 0 ? "navigasi-luring" : "navigasi-biasa";
  }

  /** Kunci simpanan HTML: jalur saja (yang ber-query tidak pernah sampai sini). */
  function kunciHalaman(url) {
    return new URL(url).pathname;
  }

  /**
   * Boleh tidaknya sebuah JAWABAN disimpan sebagai halaman `kunci`.
   *
   * Yang dijaga di sini satu hal yang tidak kelihatan sampai ia terjadi: sesi
   * yang kedaluwarsa membuat server MENGALIHKAN ke `/masuk`, dan jawaban itu
   * tetap ber-status 200. Tanpa pemeriksaan alamat akhir, halaman masuk akan
   * tersimpan dengan nama `/foto-cepat` — dan mandor yang membukanya di luar
   * jangkauan akan disodori formulir masuk yang tidak mungkin dia lewati.
   *
   * @param {{kunci: string, urlAkhir: string, redirected?: boolean, status: number, tipe?: string}} p
   */
  function bolehSimpanHalaman(p) {
    if (p.status !== 200) return false;
    if (p.tipe && p.tipe !== "basic") return false;
    if (p.redirected) return false;
    try {
      return new URL(p.urlAkhir).pathname === p.kunci;
    } catch (_) {
      return false;
    }
  }

  /**
   * Jarak minimal antar penyegaran simpanan luring.
   *
   * Penyiapan dijalankan tiap kali aplikasi dibuka; tanpa jeda ini, tiap muat
   * halaman membayar satu render `/foto-cepat` di server (query lokasi +
   * kantong) hanya untuk menyalin yang sudah ada.
   */
  var JEDA_SIAP_MS = 15 * 60 * 1000;

  /** Cache milik MARLIN dari versi lama — boleh dibuang saat aktivasi. */
  function cacheUsang(nama) {
    if (nama.indexOf(AWALAN) !== 0) return false;
    return nama !== NAMA.kerangka && nama !== NAMA.aset && nama !== NAMA.halaman;
  }

  lingkup.KEBIJAKAN_SW = {
    VERSI: VERSI,
    NAMA: NAMA,
    HALAMAN_OFFLINE: HALAMAN_OFFLINE,
    KUNCI_META: KUNCI_META,
    CAP_SIMPAN: CAP_SIMPAN,
    RUTE_LURING: RUTE_LURING,
    PRAPASANG: PRAPASANG,
    JEDA_SIAP_MS: JEDA_SIAP_MS,
    rencana: rencana,
    kunciHalaman: kunciHalaman,
    bolehSimpanHalaman: bolehSimpanHalaman,
    cacheUsang: cacheUsang,
  };
})(typeof self !== "undefined" ? self : globalThis);
