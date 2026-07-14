import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "16mb", // upload dokumen (file lewat server action)
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: process.env.R2_PUBLIC_HOSTNAME || "*.r2.cloudflarestorage.com",
      },
    ],
  },
  poweredByHeader: false,
  compress: true,
  // Sertakan font bundel di server bundle (untuk cap foto via sharp/librsvg).
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/**"],
  },
};

export default nextConfig;
