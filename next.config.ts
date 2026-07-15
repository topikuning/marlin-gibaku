import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // sharp = binari native: JANGAN dibundel webpack (rusak). Biarkan resolve
  // sebagai require runtime dari node_modules (lihat setup sharp di Dockerfile).
  serverExternalPackages: ["sharp"],
  experimental: {
    serverActions: {
      bodySizeLimit: "16mb", // upload dokumen/foto lewat server action
    },
  },
  // Sertakan font bundel (cap foto via sharp) + seed-data (bootstrap data demo).
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/**", "./seed-data/**"],
  },
};

export default nextConfig;
