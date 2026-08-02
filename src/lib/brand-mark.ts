/**
 * IKON MARLIN sebagai geometri — SATU sumber untuk semua penyaji.
 *
 * Berkas resminya ada di `public/brand/marlin-icon*.svg` (dari user
 * 2026-08-02). Yang ditaruh di sini hanya PATH-nya, karena ikon ini dipakai di
 * tempat yang tidak bisa memuat berkas: cap foto dirakit sebagai SATU string
 * SVG lalu diraster sharp, jadi ia tidak bisa `<img src>`. Menyalin path ke
 * dua tempat berarti suatu hari keduanya berbeda — dan yang berbeda itu logo.
 *
 * Koordinat mengikuti viewBox 0 0 96 96 persis seperti berkas aslinya, supaya
 * perbandingan visual dengan berkas resmi selalu bisa dilakukan.
 *
 * DECISIONS 223.
 */

/** viewBox ikon: 0 0 96 96. */
export const MARK_VIEWBOX = 96;

/** Warna resmi dari `public/brand/README.txt`. */
export const BRAND_COLORS = {
  biru: "#1E3A8A",
  merah: "#D21F2A",
  teksUtama: "#0F172A",
  teksSekunder: "#64748B",
  latarGelap: "#08152E",
} as const;

/** Huruf "M" — bentuk dasar ikon. */
const PATH_M =
  "M10 88 L10 24 L28 24 L48 50 L68 24 L86 24 L86 88 L70 88 L70 46 L48 74 L26 46 L26 88 Z";
/** Kurva "kail" yang melintasi M, dari kiri-bawah ke kanan-atas. */
const PATH_KURVA = "M10 80 C28 80 36 66 48 50 C60 34 70 26 88 18";

/**
 * Rakit isi ikon (tanpa elemen `<svg>` pembungkus) pada skala & posisi tertentu.
 *
 * `varian`:
 * - `warna` — biru + merah, untuk latar TERANG;
 * - `putih` — M putih dengan kurva ber-outline gelap, untuk latar gelap atau
 *   FOTO. Di foto, satu warna solid tanpa outline akan lenyap begitu latarnya
 *   kebetulan seterang tinta (DECISIONS 223).
 */
export function markSvgInner(
  x: number,
  y: number,
  size: number,
  varian: "warna" | "putih" = "warna",
  /** Warna outline kurva pada varian putih — samakan dengan latar bila diketahui. */
  outline: string = BRAND_COLORS.latarGelap,
): string {
  const s = size / MARK_VIEWBOX;
  const isiM = varian === "putih" ? "#FFFFFF" : BRAND_COLORS.biru;
  const strokeLuar = varian === "putih" ? outline : "#FFFFFF";
  const strokeDalam = varian === "putih" ? "#FFFFFF" : BRAND_COLORS.merah;
  const titikLuar = varian === "putih" ? outline : "#FFFFFF";
  const titikDalam = varian === "putih" ? "#FFFFFF" : BRAND_COLORS.merah;
  return (
    `<g transform="translate(${x},${y}) scale(${s.toFixed(5)})">` +
    `<path d="${PATH_M}" fill="${isiM}"/>` +
    `<path d="${PATH_KURVA}" fill="none" stroke="${strokeLuar}" stroke-width="11" stroke-linecap="round"/>` +
    `<path d="${PATH_KURVA}" fill="none" stroke="${strokeDalam}" stroke-width="5.5" stroke-linecap="round"/>` +
    `<circle cx="88" cy="18" r="7.5" fill="${titikLuar}"/>` +
    `<circle cx="88" cy="18" r="4.5" fill="${titikDalam}"/>` +
    `</g>`
  );
}
