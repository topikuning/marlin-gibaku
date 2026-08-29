import type { NextConfig } from "next";

/**
 * Penanda build, dibekukan saat kompilasi dan ikut ter-inline ke bundel klien.
 *
 * Dipakai mendeteksi tab yang lebih tua dari servernya. ID server action
 * di-hash per build: sesudah deploy, halaman yang sudah terbuka membawa ID yang
 * TIDAK ADA LAGI di server, dan setiap pengiriman dari tab itu ditolak dengan
 * `UnrecognizedActionError` — kerja yang sudah diketik hilang di detik terakhir
 * (DECISIONS 292).
 *
 * SHA commit dipakai bila platform menyediakannya supaya nilainya stabil untuk
 * build yang sama; kalau tidak ada, cap waktu build sudah cukup — yang
 * dibutuhkan cuma "berubah setiap build".
 */
const BUILD_ID =
  process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.MARLIN_BUILD_ID ?? String(Date.now());

const nextConfig: NextConfig = {
  output: "standalone",
  env: { MARLIN_BUILD_ID: BUILD_ID },
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
  // Berkas-berkas ini dijangkau lewat `path.join(process.cwd(), ...)` di
  // runtime, yang tidak bisa dilihat penelusur statis — karena itu disebut
  // eksplisit di sini. Tiap pemanggilnya diberi `/*turbopackIgnore: true*/`
  // supaya penelusur berhenti menganggapnya require dinamis dan menyeret
  // SELURUH proyek ke image (review 2026-08-29).
  outputFileTracingIncludes: {
    "/**": [
      "./assets/**",
      "./seed-data/**",
      "./node_modules/.pnpm/sharp@*/**",
      "./node_modules/.pnpm/@img+*/**",
    ],
  },
};

export default nextConfig;
