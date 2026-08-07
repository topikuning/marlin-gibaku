import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Build yang SEDANG berjalan di server — dipakai klien untuk mendeteksi tab
 * yang lebih tua dari servernya (lihat components/shell/pengawas-versi.tsx).
 *
 * SENGAJA tidak menyentuh database. Berbeda dari `/api/health`, endpoint ini
 * dipanggil berkala oleh setiap tab yang terbuka; menempelkan query ke sini
 * berarti membayar beban DB hanya untuk menanyakan sebuah string.
 */
export function GET() {
  return NextResponse.json(
    { build: process.env.MARLIN_BUILD_ID ?? "" },
    { headers: { "cache-control": "no-store" } },
  );
}
