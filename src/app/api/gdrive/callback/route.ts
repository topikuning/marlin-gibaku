import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { getGDriveAuth, storeGDriveToken } from "@/lib/gdrive/config";
import { appUrl, driveRedirectUriFrom } from "@/lib/gdrive/origin";

export const dynamic = "force-dynamic";

/** Decode payload id_token (display email saja — TANPA verifikasi tanda tangan; bukan untuk authz). */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const j = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { email?: string };
    return typeof j.email === "string" ? j.email : null;
  } catch {
    return null;
  }
}

/** Callback OAuth Google: tukar code → refresh token, simpan terenkripsi. DECISIONS 141. */
export async function GET(request: NextRequest) {
  // Origin publik, bukan request.nextUrl.origin: di container yang terakhir
  // berisi http://0.0.0.0:8080 dan browser pengguna gagal membukanya.
  const done = (q: string) =>
    NextResponse.redirect(appUrl(`/administrasi/sistem?gdrive=${q}`, request.headers, request.nextUrl.origin));

  const user = await getCurrentUser();
  if (!user || !can(user.role, "system.manage")) return done("tanpa-izin");

  const sp = request.nextUrl.searchParams;
  const state = sp.get("state");
  const cookieState = request.cookies.get("gdrive_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) return done("state-salah");
  if (sp.get("error")) return done("ditolak");
  const code = sp.get("code");
  if (!code) return done("tanpa-code");

  const auth = await getGDriveAuth();
  if (!auth) return done("belum-konfigurasi");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      code,
      grant_type: "authorization_code",
      // Harus PERSIS sama dengan yang dipakai saat meminta consent.
      redirect_uri: driveRedirectUriFrom(request.headers) ?? "",
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res || !res.ok) return done("tukar-gagal");

  const j = (await res.json()) as { refresh_token?: string; id_token?: string };
  if (!j.refresh_token) return done("tanpa-refresh-token");

  await storeGDriveToken(j.refresh_token, emailFromIdToken(j.id_token));
  await audit(user.id, "gdrive.connect", "app_setting", null, {
    email: emailFromIdToken(j.id_token),
  });
  const out = done("terhubung");
  out.cookies.delete("gdrive_oauth_state");
  return out;
}
