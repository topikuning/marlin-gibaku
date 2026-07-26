import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { getGDriveConfigDisplay } from "@/lib/gdrive/config";
import { driveRedirectUri } from "@/lib/gdrive/parse";

export const dynamic = "force-dynamic";

/**
 * Mulai OAuth Google Drive (admin): redirect ke consent Google dengan
 * access_type=offline + prompt=consent supaya dapat refresh token. State
 * anti-CSRF disimpan di cookie httpOnly 10 menit. DECISIONS 141.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "system.manage")) {
    return NextResponse.redirect(new URL("/sistem", request.nextUrl.origin));
  }
  const cfg = await getGDriveConfigDisplay();
  if (!cfg.clientId || !cfg.hasClientSecret) {
    return NextResponse.redirect(new URL("/sistem?gdrive=belum-konfigurasi", request.nextUrl.origin));
  }

  const state = randomBytes(16).toString("hex");
  // Bukan request.nextUrl.origin: di belakang proxy Railway skemanya http dan
  // Google menolak redirect URI http untuk domain publik (error 400).
  const redirectUri = driveRedirectUri(
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    request.headers.get("x-forwarded-proto"),
  );
  if (!redirectUri) return NextResponse.redirect(new URL("/sistem?gdrive=host-tak-diketahui", request.nextUrl.origin));
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // Scope penuh drive: harus bisa menulis ke folder KKP yang BUKAN dibuat app
    // ini (drive.file tidak cukup — hanya file buatan app sendiri).
    scope: "https://www.googleapis.com/auth/drive openid email",
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("gdrive_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/api/gdrive",
  });
  return res;
}
