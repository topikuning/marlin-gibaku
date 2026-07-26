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
};

export default nextConfig;
