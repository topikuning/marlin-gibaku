import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // sharp = binari native + pdfkit = require dinamis file data: JANGAN dibundel
  // webpack (rusak). Biarkan resolve sebagai require runtime dari node_modules
  // (lihat setup sharp di Dockerfile; pdfkit di outputFileTracingIncludes).
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
  outputFileTracingIncludes: {
    "/**": [
      "./assets/fonts/**",
      "./seed-data/**",
      "./node_modules/.pnpm/sharp@*/**",
      "./node_modules/.pnpm/@img+*/**",
      // pdfkit + fontkit: butuh file DATA (.afm, trie unicode) yang dirujuk via
      // require dinamis/fs — tracer statik Next tak melihatnya. Include eksplisit
      // agar render PDF server-side tidak gagal "ENOENT" di standalone. DECISIONS 124.
      "./node_modules/.pnpm/pdfkit@*/**",
      "./node_modules/.pnpm/fontkit@*/**",
      "./node_modules/.pnpm/unicode-properties@*/**",
      "./node_modules/.pnpm/unicode-trie@*/**",
      "./node_modules/.pnpm/linebreak@*/**",
      "./node_modules/.pnpm/brotli@*/**",
      "./node_modules/.pnpm/dfa@*/**",
      "./node_modules/.pnpm/png-js@*/**",
    ],
  },
};

export default nextConfig;
