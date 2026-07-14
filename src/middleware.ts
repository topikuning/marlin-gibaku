import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/masuk", "/api/health", "/api/ready"];
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
