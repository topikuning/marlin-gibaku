import "server-only";
import { encryptionKeyFromEnv, readStoredSecret, secretUntukSimpan } from "@/lib/ai/crypto";
import { latestSettings, putAiSetting } from "@/lib/ai/config";
import { getGDriveAuth } from "@/lib/gdrive/config";
import { kunciCadanganDari } from "./sandi";

/**
 * AKUN GOOGLE CADANGAN (DECISIONS 650) – sambungan KEDUA, terpisah dari akun
 * editor folder KKP (DECISIONS 141).
 *
 * Kenapa terpisah: akun KKP dipakai menyetor laporan ke folder milik pemberi
 * kerja; akun cadangan adalah akun pribadi Google One 2TB milik user. Boleh
 * saja akun yang sama – sambungkan dua kali – tapi MARLIN tidak boleh
 * menganggapnya sama.
 *
 * Memakai OAuth client yang SAMA (client ID/secret di Sistem → Google Drive),
 * jadi tidak ada pengaturan baru di Google Cloud. Scope-nya `drive.file`:
 * MARLIN hanya bisa melihat berkas yang ia buat sendiri, bukan isi Drive
 * pribadi user yang lain.
 */

const KEY_REFRESH_TOKEN = "cadangan.refresh_token";
const KEY_EMAIL = "cadangan.account_email";
const KEY_FOLDER = "cadangan.folder_id";
const KEY_AKTIF = "cadangan.aktif";

export const SCOPE_CADANGAN = "https://www.googleapis.com/auth/drive.file openid email";

export type TampilanAkunCadangan = {
  /** Client ID/secret Google sudah diisi (dipakai bersama sambungan KKP). */
  adaClient: boolean;
  terhubung: boolean;
  email: string | null;
  folderId: string | null;
  aktif: boolean;
  adaKunci: boolean;
};

export async function tampilanAkunCadangan(): Promise<TampilanAkunCadangan> {
  const [s, client] = await Promise.all([
    latestSettings([KEY_REFRESH_TOKEN, KEY_EMAIL, KEY_FOLDER, KEY_AKTIF]),
    getGDriveAuth(),
  ]);
  return {
    adaClient: client !== null,
    terhubung: !!s.get(KEY_REFRESH_TOKEN),
    email: s.get(KEY_EMAIL) || null,
    folderId: s.get(KEY_FOLDER) || null,
    // Bawaan HIDUP: begitu akun tersambung, cadangan berjalan. Tombolnya ada
    // untuk menjeda, bukan untuk menyalakan.
    aktif: s.get(KEY_AKTIF) !== "0",
    adaKunci: kunciCadangan() !== null,
  };
}

export function kunciCadangan(): Buffer | null {
  return kunciCadanganDari(process.env.BACKUP_ENCRYPTION_KEY);
}

export async function simpanTokenCadangan(refreshToken: string, email: string | null): Promise<void> {
  await putAiSetting(KEY_REFRESH_TOKEN, secretUntukSimpan(refreshToken));
  await putAiSetting(KEY_EMAIL, email ?? "");
  // Akun bisa berganti – folder akun lama tidak terlihat oleh akun baru.
  await putAiSetting(KEY_FOLDER, "");
  tokenCache = null;
}

export async function putuskanAkunCadangan(): Promise<void> {
  await putAiSetting(KEY_REFRESH_TOKEN, "");
  await putAiSetting(KEY_EMAIL, "");
  await putAiSetting(KEY_FOLDER, "");
  tokenCache = null;
}

export async function setAktifCadangan(aktif: boolean): Promise<void> {
  await putAiSetting(KEY_AKTIF, aktif ? "1" : "0");
}

export async function simpanFolderCadangan(folderId: string): Promise<void> {
  await putAiSetting(KEY_FOLDER, folderId);
}

export class CadanganError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "CadanganError";
    this.status = status;
  }
}

let tokenCache: { token: string; habis: number } | null = null;

/** Access token akun cadangan (di-cache per proses, diperbarui 60 detik sebelum habis). */
export async function tokenCadangan(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.habis) return tokenCache.token;
  const client = await getGDriveAuth();
  if (!client) throw new CadanganError("Client ID/secret Google belum diisi (Sistem → Google Drive).");
  const s = await latestSettings([KEY_REFRESH_TOKEN]);
  const raw = s.get(KEY_REFRESH_TOKEN);
  const refresh = raw ? readStoredSecret(raw, encryptionKeyFromEnv()) : null;
  if (!refresh) throw new CadanganError("Akun Google untuk cadangan belum tersambung.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const teks = await res.text().catch(() => "");
    throw new CadanganError(
      teks.includes("invalid_grant")
        ? "Izin akun Google cadangan sudah kedaluwarsa atau dicabut. Sambungkan lagi di Sistem. (Pastikan aplikasi OAuth berstatus In production, bukan Testing.)"
        : `Gagal memperbarui izin akun Google cadangan (HTTP ${res.status}).`,
      res.status,
    );
  }
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache = { token: j.access_token, habis: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
  return j.access_token;
}
