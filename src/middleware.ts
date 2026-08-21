import { NextResponse, type NextRequest } from "next/server";

// Catatan: /api/waha/webhook WAJIB publik — WAHA mem-POST tanpa cookie sesi;
// endpoint itu mengautentikasi dirinya sendiri via token (?token=/header).
// /api/foto = link foto publik untuk PDF yang dikirim ke WA (auth via token HMAC).
// /api/cron = pekerjaan terjadwal, otentikasi lewat header CRON_SECRET (bukan
// sesi — penjadwal tidak punya cookie). Lihat api/cron/harian/route.ts.
// /offline = halaman "tidak ada jaringan" milik service worker (DECISIONS 398).
// WAJIB publik karena dua alasan yang dua-duanya sudah pernah salah:
//  1. service worker MENJEMPUTNYA saat pemasangan. Kalau ia dialihkan ke
//     /masuk, `cache.add` menyimpan halaman MASUK di bawah kunci `/offline`
//     (redirect diikuti, hasil akhirnya 200) — jadi orang yang kehilangan
//     sinyal disodori formulir masuk yang mustahil ia lewati. Penjaga
//     `bolehSimpanHalaman` tidak menolong di sini: prapasang lewat `cache.add`
//     tidak melewatinya.
//  2. halamannya sendiri menyatakan dirinya "di luar (app) supaya tidak
//     melewati penjaga sesi". Middleware membuat pernyataan itu tidak benar.
const PUBLIC_PATHS = [
  "/masuk",
  "/offline",
  "/api/health",
  "/api/ready",
  "/api/waha/webhook",
  "/api/foto",
  "/api/cron",
];
const SESSION_COOKIE = "marlin_session";

/**
 * Middleware ringan: hanya cek keberadaan cookie sesi + redirect ke /masuk.
 * Validasi sesi sesungguhnya + otorisasi capability terjadi di data layer
 * (requireUser/requireCapability) — middleware bukan satu-satunya pagar.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/masuk";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.*|.*\\.(?:svg|png|jpg|jpeg|webp|ico|css|js)$).*)"],
};
