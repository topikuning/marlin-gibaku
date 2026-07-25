import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * Konfigurasi WAHA (WhatsApp HTTP API) disimpan sebagai SETTING APLIKASI di DB
 * (AppSetting key-value, effective-dated) — bukan environment. Admin mengaturnya
 * di halaman Sistem tanpa perlu redeploy. Pola sama dengan Branding.
 *
 * API key bersifat rahasia: hanya dibaca di server (server-only), tidak pernah
 * dikirim ke klien. Form Sistem menampilkan key sebagai tersamar; menyimpan
 * dengan field key kosong TIDAK menghapus key lama (lihat setWahaConfig).
 */

export type WahaConfig = { baseUrl: string; apiKey: string; session: string };

export const WAHA_KEYS = {
  baseUrl: "waha.base_url",
  apiKey: "waha.api_key",
  session: "waha.session",
} as const;

export class WahaConfigError extends Error {}

/** Normalisasi base URL WAHA: wajib http(s), buang trailing slash & path /api. */
export function normalizeWahaBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    throw new WahaConfigError(`URL WAHA tidak valid: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WahaConfigError("URL WAHA wajib http(s)");
  }
  const path = url.pathname.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

/** Nilai efektif terbaru per key (peta key→value). */
async function latestSettings(): Promise<Map<string, string>> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: Object.values(WAHA_KEYS) } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  const latest = new Map<string, string>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r.value);
  return latest;
}

/** Config lengkap (baseUrl + apiKey wajib) atau null bila belum diatur. */
export async function getWahaConfig(): Promise<WahaConfig | null> {
  const s = await latestSettings();
  const baseUrl = s.get(WAHA_KEYS.baseUrl)?.trim();
  const apiKey = s.get(WAHA_KEYS.apiKey)?.trim();
  const session = s.get(WAHA_KEYS.session)?.trim() || "default";
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, session };
}

/** Sudah terkonfigurasi (base URL + api key ada)? */
export async function isWahaConfigured(): Promise<boolean> {
  return (await getWahaConfig()) != null;
}

/** Untuk tampilan form: base URL, session, dan apakah key sudah tersimpan (tanpa membocorkan key). */
export async function getWahaConfigDisplay(): Promise<{ baseUrl: string; session: string; hasApiKey: boolean }> {
  const s = await latestSettings();
  return {
    baseUrl: s.get(WAHA_KEYS.baseUrl)?.trim() ?? "",
    session: s.get(WAHA_KEYS.session)?.trim() ?? "default",
    hasApiKey: !!s.get(WAHA_KEYS.apiKey)?.trim(),
  };
}

/**
 * Simpan konfigurasi WAHA (efektif hari ini). apiKey `undefined` = jangan ubah
 * (pertahankan yang lama); string kosong = hapus. baseUrl kosong = hapus.
 */
export async function setWahaConfig(input: {
  baseUrl?: string;
  apiKey?: string;
  session?: string;
}): Promise<void> {
  const effectiveFrom = jakartaToday();
  const put = async (key: string, value: string) => {
    await db.appSetting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom } },
      update: { value },
      create: { key, value, effectiveFrom },
    });
  };

  if (input.baseUrl !== undefined) {
    const v = input.baseUrl.trim();
    await put(WAHA_KEYS.baseUrl, v ? normalizeWahaBaseUrl(v) : "");
  }
  if (input.session !== undefined) {
    await put(WAHA_KEYS.session, input.session.trim() || "default");
  }
  // apiKey: hanya tulis bila DIBERIKAN (undefined = biarkan). String kosong = hapus.
  if (input.apiKey !== undefined) {
    await put(WAHA_KEYS.apiKey, input.apiKey.trim());
  }
}
