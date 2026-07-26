import "server-only";
import { encryptionKeyFromEnv, encryptSecret, readStoredSecret } from "@/lib/ai/crypto";
import { latestSettings, putAiSetting } from "@/lib/ai/config";

/**
 * Konfigurasi Google Drive sebagai SETTING APLIKASI (AppSetting) — bukan env.
 * Folder Drive per paket adalah pemberian KKP; MARLIN mengakses lewat OAuth
 * akun Gmail yang terdaftar sebagai editor folder. Client secret & refresh
 * token disimpan TERENKRIPSI (AES-256-GCM, pola sama dgn API key AI).
 * DECISIONS 141.
 */

const KEY_CLIENT_ID = "gdrive.client_id";
const KEY_CLIENT_SECRET = "gdrive.client_secret";
const KEY_REFRESH_TOKEN = "gdrive.refresh_token";
const KEY_EMAIL = "gdrive.account_email";

export type GDriveConfigDisplay = {
  clientId: string;
  hasClientSecret: boolean;
  connected: boolean;
  accountEmail: string | null;
};

export async function getGDriveConfigDisplay(): Promise<GDriveConfigDisplay> {
  const s = await latestSettings([KEY_CLIENT_ID, KEY_CLIENT_SECRET, KEY_REFRESH_TOKEN, KEY_EMAIL]);
  return {
    clientId: s.get(KEY_CLIENT_ID) ?? "",
    hasClientSecret: !!s.get(KEY_CLIENT_SECRET),
    connected: !!s.get(KEY_REFRESH_TOKEN),
    accountEmail: s.get(KEY_EMAIL) || null,
  };
}

export type GDriveAuth = { clientId: string; clientSecret: string; refreshToken: string | null };

/** Kredensial terdekripsi (server-only). Null bila client ID/secret belum diisi. */
export async function getGDriveAuth(): Promise<GDriveAuth | null> {
  const s = await latestSettings([KEY_CLIENT_ID, KEY_CLIENT_SECRET, KEY_REFRESH_TOKEN]);
  const clientId = s.get(KEY_CLIENT_ID);
  const rawSecret = s.get(KEY_CLIENT_SECRET);
  if (!clientId || !rawSecret) return null;
  const key = encryptionKeyFromEnv();
  const clientSecret = readStoredSecret(rawSecret, key);
  if (!clientSecret) return null;
  const rawToken = s.get(KEY_REFRESH_TOKEN);
  return {
    clientId,
    clientSecret,
    refreshToken: rawToken ? readStoredSecret(rawToken, key) : null,
  };
}

function protect(plain: string): string {
  const key = encryptionKeyFromEnv();
  return key ? encryptSecret(plain, key) : plain;
}

export async function saveGDriveClient(clientId: string, clientSecret: string | null): Promise<void> {
  await putAiSetting(KEY_CLIENT_ID, clientId);
  if (clientSecret) await putAiSetting(KEY_CLIENT_SECRET, protect(clientSecret));
}

export async function storeGDriveToken(refreshToken: string, email: string | null): Promise<void> {
  await putAiSetting(KEY_REFRESH_TOKEN, protect(refreshToken));
  await putAiSetting(KEY_EMAIL, email ?? "");
}

export async function clearGDriveToken(): Promise<void> {
  await putAiSetting(KEY_REFRESH_TOKEN, "");
  await putAiSetting(KEY_EMAIL, "");
}
