import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MARLIN — Monitoring, Analysis, Reporting & Learning for Infrastructure Network",
  description:
    "MARLIN — Monitoring, Analysis, Reporting & Learning for Infrastructure Network. Pemantauan proyek Kampung Nelayan Merah Putih (KNMP).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#1e3a8a" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
