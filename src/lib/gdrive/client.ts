import "server-only";
import { getGDriveAuth } from "./config";
import { buildMultipartBody } from "./parse";

/**
 * Klien Google Drive v3 via fetch murni (tanpa SDK googleapis — hemat bundle).
 * Auth: OAuth refresh token akun Gmail editor folder KKP. Selalu
 * `supportsAllDrives=true` agar folder Shared Drive maupun My Drive sama-sama
 * jalan. DECISIONS 141.
 */

export class GDriveError extends Error {}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink";

// Cache access token per proses (habis ~1 jam; refresh 60 dtk lebih awal).
let cached: { token: string; expiresAt: number } | null = null;

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: { message?: string }; error_description?: string };
    return j.error?.message ?? j.error_description ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200) || `HTTP ${res.status}`;
  }
}

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const auth = await getGDriveAuth();
  if (!auth) throw new GDriveError("Client ID/secret Google belum diisi (Sistem → Integrasi → Google Drive).");
  if (!auth.refreshToken)
    throw new GDriveError("Akun Google belum terhubung — klik “Hubungkan akun Google” di Sistem.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      refresh_token: auth.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const msg = await readError(res);
    // invalid_grant = token dicabut/kedaluwarsa (mis. app masih status Testing).
    throw new GDriveError(
      msg.includes("invalid_grant")
        ? "Token Google kedaluwarsa/dicabut — hubungkan ulang akun di Sistem. (Pastikan OAuth app berstatus In production, bukan Testing.)"
        : `Gagal menyegarkan token Google: ${msg}`,
    );
  }
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: j.access_token, expiresAt: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
  return j.access_token;
}

export type DriveFile = { id: string; name: string; webViewLink: string | null };

/** Upload satu file ke folder. Error → GDriveError (pesan siap tampil). */
export async function uploadToDrive(input: {
  folderId: string;
  fileName: string;
  mime: string;
  data: Buffer;
}): Promise<DriveFile> {
  const token = await getAccessToken();
  const { body, contentType } = buildMultipartBody(
    { name: input.fileName, parents: [input.folderId] },
    input.mime,
    input.data,
  );
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const msg = await readError(res);
    throw new GDriveError(
      res.status === 404
        ? "Folder Drive tidak ditemukan / akun tidak punya akses. Cek ID folder di paket & hak editor akun."
        : `Upload ke Drive gagal: ${msg}`,
    );
  }
  const j = (await res.json()) as { id: string; name: string; webViewLink?: string };
  return { id: j.id, name: j.name, webViewLink: j.webViewLink ?? null };
}

/** Validasi akses folder (dipakai saat menyimpan ID folder di paket). */
export async function probeDriveFolder(folderId: string): Promise<{ name: string }> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) {
    throw new GDriveError(
      res.status === 404
        ? "Folder tidak ditemukan atau akun Google MARLIN belum diberi akses editor ke folder ini."
        : `Gagal membaca folder: ${await readError(res)}`,
    );
  }
  const j = (await res.json()) as { name: string; mimeType?: string };
  if (j.mimeType !== "application/vnd.google-apps.folder")
    throw new GDriveError("ID tersebut bukan folder Drive.");
  return { name: j.name };
}

/** Identitas akun terhubung (untuk tombol Tes di Sistem). */
export async function driveAbout(): Promise<{ email: string | null; name: string | null }> {
  const token = await getAccessToken();
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new GDriveError(`Gagal membaca info akun: ${await readError(res)}`);
  const j = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
  return { email: j.user?.emailAddress ?? null, name: j.user?.displayName ?? null };
}
