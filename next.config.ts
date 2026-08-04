import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // sharp = binari native + pdfkit = require dinamis file data: JANGAN dibundel
  // webpack (rusak). Biarkan resolve sebagai require runtime dari node_modules
  // (lihat setup sharp di Dockerfile; pdfkit pakai bundle standalone, lihat bawah).
  serverExternalPackages: ["sharp", "pdfkit"],
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb", // upload dokumen/foto lewat server action (file maks 25MB + overhead multipart)
    },
    // middleware.ts membungkus SEMUA route → Next membatasi body request yang lewat
    // middleware via proxyClientMaxBodySize (default ~1MB). Tanpa ini, upload >1MB
    // ditolak framework SEBELUM server action jalan (500 digest, crash halaman).
    // Samakan dengan bodySizeLimit agar upload dokumen/foto lolos.
    proxyClientMaxBodySize: "30mb",
  },
  // Sertakan font bundel (cap foto via sharp) + seed-data (bootstrap data demo).
  // PLUS: paket sharp + @img LENGKAP. Tracer Next tidak bisa melihat dependensi
  // dlopen level-native (libvips-cpp.so dirujuk dari DALAM binari .node, bukan
  // dari JS) sehingga sharp tersalin SETENGAH ke standalone → runtime gagal
  // "libvips-cpp.so: cannot open shared object file". Include eksplisit ini
  // memastikan seluruh isi paket (termasuk .so) ikut ter-copy.
  // PLUS pdfkit: bundle SELF-CONTAINED DI-VENDOR ke assets/pdfkit-standalone.cjs
  // (lihat lib/pdf/document.ts) — dimuat via path absolut, tanpa resolusi
  // node_modules. Cukup pastikan file assets ikut ter-copy.
  outputFileTracingIncludes: {
    "/**": [
      "./assets/**",
      "./seed-data/**",
      "./node_modules/.pnpm/sharp@*/**",
      "./node_modules/.pnpm/@img+*/**",
    ],
  },
  /**
   * URL LAMA → URL KANONIK, permanen (308). PRD §3.1 baris 7/15/45/46 +
   * FR-NAV-03: "Alias lama memakai redirect permanen".
   *
   * Dipindah ke sini dari `page.tsx` yang memanggil `redirect()`. Bedanya
   * bukan gaya: `redirect()` di dalam page mengembalikan 307 SEMENTARA dan
   * tetap menghitung sebagai route aplikasi — persis keluhan PRD bahwa "route
   * teknis tetap terhitung dan membingungkan dokumentasi/bookmark". Sebagai
   * entri di sini, alias ditangani sebelum React dijalankan, peramban dan
   * mesin pencari memperbarui bookmark-nya sendiri, dan jumlah route benar-
   * benar berkurang.
   *
   * `/aktivitas` bukan sekadar alias: dulu ia me-render Dashboard Eksekutif
   * yang SAMA dengan `/`, jadi ada dua URL untuk satu produk. Komponennya kini
   * tinggal di `(app)/_dashboard/` — folder ber-awalan garis bawah sengaja,
   * karena App Router tidak menjadikannya route.
   */
  async redirects() {
    return [
      // ── Alias lama yang memang cuma alias ──────────────────────────────
      { source: "/aktivitas", destination: "/", permanent: true },
      { source: "/pengguna", destination: "/administrasi/pengguna", permanent: true },
      { source: "/paket/vendor", destination: "/administrasi/perusahaan", permanent: true },
      { source: "/kontak-wa", destination: "/administrasi/kontak", permanent: true },
      // Laporan → WA dilebur ke Report Studio (DECISIONS 193/194).
      {
        source: "/laporan-wa",
        destination: "/pengendalian/insight/reports?template=wa_update",
        permanent: true,
      },

      /*
       * ── MIGRASI KE KELUARGA ROUTE KANONIK (PRD §4.1) ───────────────────
       *
       * Yang lebih SPESIFIK harus lebih dulu: `/paket/katalog` pindah ke
       * Administrasi, bukan ke `/proyek/paket/katalog`, jadi ia wajib
       * dicocokkan sebelum aturan `/paket/:path*` di bawahnya.
       *
       * Tiap keluarga punya dua entri — satu untuk akar (`/paket`) dan satu
       * untuk anaknya (`/paket/:path*`). Satu entri ber-`:path*` saja TIDAK
       * mencakup akarnya, dan justru URL akar itulah yang paling sering
       * di-bookmark.
       */
      { source: "/paket/katalog", destination: "/administrasi/lokasi-master", permanent: true },
      { source: "/master/pengguna", destination: "/administrasi/pengguna", permanent: true },
      { source: "/master/perusahaan", destination: "/administrasi/perusahaan", permanent: true },
      { source: "/master/kontak-wa", destination: "/administrasi/kontak-wa", permanent: true },
      { source: "/master/kontak", destination: "/administrasi/kontak", permanent: true },

      { source: "/paket", destination: "/proyek/paket", permanent: true },
      { source: "/paket/:path*", destination: "/proyek/paket/:path*", permanent: true },
      { source: "/lokasi", destination: "/proyek/lokasi", permanent: true },
      { source: "/lokasi/:path*", destination: "/proyek/lokasi/:path*", permanent: true },
      { source: "/peta", destination: "/proyek/peta", permanent: true },

      { source: "/hari-ini", destination: "/pelaksanaan", permanent: true },
      { source: "/foto", destination: "/pelaksanaan/bukti", permanent: true },
      { source: "/foto/:path*", destination: "/pelaksanaan/bukti/:path*", permanent: true },

      { source: "/progress", destination: "/pengendalian/progress", permanent: true },
      { source: "/keuangan", destination: "/pengendalian/keuangan", permanent: true },
      { source: "/ai", destination: "/pengendalian/insight", permanent: true },
      { source: "/ai/:path*", destination: "/pengendalian/insight/:path*", permanent: true },

      { source: "/dokumen", destination: "/dokumen-laporan/dokumen", permanent: true },
      { source: "/dokumen/:path*", destination: "/dokumen-laporan/dokumen/:path*", permanent: true },
      { source: "/laporan", destination: "/dokumen-laporan/laporan", permanent: true },
      { source: "/laporan/:path*", destination: "/dokumen-laporan/laporan/:path*", permanent: true },
      { source: "/chat-grup", destination: "/dokumen-laporan/distribusi", permanent: true },
      {
        source: "/chat-grup/:path*",
        destination: "/dokumen-laporan/distribusi/:path*",
        permanent: true,
      },

      { source: "/master", destination: "/administrasi", permanent: true },
      { source: "/sistem", destination: "/administrasi/sistem", permanent: true },
      { source: "/sistem/:path*", destination: "/administrasi/sistem/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
