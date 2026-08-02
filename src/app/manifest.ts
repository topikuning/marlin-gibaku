import type { MetadataRoute } from "next";
import { getBranding } from "@/lib/branding";

/**
 * Manifest PWA — supaya MARLIN bisa dipasang di layar depan HP mandor dengan
 * ikon resminya, bukan tangkapan layar halaman.
 *
 * Nama dibaca dari branding (DECISIONS 166: satu basis kode melayani klien mana
 * pun), sedangkan IKONNYA tetap ikon aplikasi — ia identitas produk, bukan
 * identitas pemilik pekerjaan. Logo pemilik punya tempatnya sendiri di kop
 * blanko. DECISIONS 223.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await getBranding();
  return {
    name: `${brand.appName} — ${brand.tagline}`,
    short_name: brand.appName,
    description: brand.projectContext,
    start_url: "/",
    display: "standalone",
    background_color: "#08152E",
    theme_color: "#1E3A8A",
    lang: "id",
    icons: [
      { src: "/brand/marlin-favicon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/marlin-favicon-512.png", sizes: "512x512", type: "image/png" },
      // `maskable`: Android memotong ikon jadi bentuk sistem. Ikon persegi
      // ber-latar penuh aman dipotong; ikon transparan akan terlihat terpangkas.
      { src: "/brand/marlin-favicon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
