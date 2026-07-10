import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // untuk photo upload metadata
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
};

export default nextConfig;
