import "server-only";
import { encryptionKeyFromEnv, readStoredSecret, secretUntukSimpan } from "@/lib/ai/crypto";
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
  webhookSecret: "waha.webhook_secret",
  /**
   * Boleh mengirim ke NOMOR PRIBADI (bukan grup)? "1" = boleh.
   *
   * Bawaannya MATI (DECISIONS 433). Ketetapan user 2026-08-25: WhatsApp
   * memblokir nomor cukup agresif bila banyak mengirim chat pribadi, dan
   * nomor yang terblokir menjatuhkan SELURUH kanal WA — termasuk kiriman ke
   * grup yang justru inti pemakaian MARLIN. Karena itu pagar ini menutup
   * secara bawaan, dan hanya dibuka sadar oleh admin di Sistem.
   */
  izinkanPersonal: "waha.izinkan_personal",
} as const;

export class WahaConfigError extends Error {}

/** Host yang lazim dipakai tanpa TLS: private networking Railway, localhost, IP privat. */
export function isInternalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return (
    h.endsWith(".railway.internal") ||
    h.endsWith(".internal") ||
    h === "localhost" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/**
 * Normalisasi base URL WAHA: wajib http(s), buang trailing slash & path /api.
 * Tanpa skema: host internal (mis. `waha.railway.internal:3000`) di-default ke
 * `http://` — private networking Railway TIDAK ber-TLS, memaksakan https membuat
 * koneksi selalu gagal; host publik tetap default `https://`.
 */
export function normalizeWahaBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const defaultProto = isInternalHost(trimmed.split("/")[0] ?? "") ? "http" : "https";
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `${defaultProto}://${trimmed}`;
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

/**
 * Buka nilai rahasia tersimpan. Nilai lama yang masih plaintext tetap terbaca
 * (migrasi boot yang mengenkripsi-ulangnya — `migrasi/rahasia-terenkripsi.ts`);
 * ciphertext tanpa kunci yang benar terbaca `null`, dan pemanggil
 * memperlakukannya sebagai "belum dikonfigurasi" — JANGAN pernah meneruskan
 * ciphertext-nya sebagai kalau-kalau itu kuncinya.
 */
function bukaRahasia(stored: string | undefined): string {
  const raw = stored?.trim();
  if (!raw) return "";
  return readStoredSecret(raw, encryptionKeyFromEnv())?.trim() ?? "";
}

/** Config lengkap (baseUrl + apiKey wajib) atau null bila belum diatur. */
export async function getWahaConfig(): Promise<WahaConfig | null> {
  const s = await latestSettings();
  const baseUrl = s.get(WAHA_KEYS.baseUrl)?.trim();
  const apiKey = bukaRahasia(s.get(WAHA_KEYS.apiKey));
  const session = s.get(WAHA_KEYS.session)?.trim() || "default";
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, session };
}

/** Sudah terkonfigurasi (base URL + api key ada)? */
export async function isWahaConfigured(): Promise<boolean> {
  return (await getWahaConfig()) != null;
}

/** Untuk tampilan form: base URL, session, dan apakah key sudah tersimpan (tanpa membocorkan key). */
export async function getWahaConfigDisplay(): Promise<{
  baseUrl: string;
  session: string;
  hasApiKey: boolean;
  webhookSecret: string;
  izinkanPersonal: boolean;
}> {
  const s = await latestSettings();
  return {
    baseUrl: s.get(WAHA_KEYS.baseUrl)?.trim() ?? "",
    session: s.get(WAHA_KEYS.session)?.trim() ?? "default",
    hasApiKey: !!s.get(WAHA_KEYS.apiKey)?.trim(),
    // Secret webhook ditampilkan penuh (admin harus menyalinnya ke WAHA), jadi
    // ia memang DIBUKA di sini — layarnya sudah dipagari kapabilitas.
    webhookSecret: bukaRahasia(s.get(WAHA_KEYS.webhookSecret)),
    izinkanPersonal: (s.get(WAHA_KEYS.izinkanPersonal) ?? "").trim() === "1",
  };
}

/** Boleh kirim ke nomor pribadi? Bawaan: TIDAK (lihat catatan di WAHA_KEYS). */
export async function izinKirimPersonal(): Promise<boolean> {
  const s = await latestSettings();
  return (s.get(WAHA_KEYS.izinkanPersonal) ?? "").trim() === "1";
}

/** Secret untuk memverifikasi webhook inbound WAHA (query `?token=` / header). */
export async function getWahaWebhookSecret(): Promise<string | null> {
  const s = await latestSettings();
  return bukaRahasia(s.get(WAHA_KEYS.webhookSecret)) || null;
}

/* ── Diagnostik webhook: log SETIAP POST yang mendarat (self-service Sistem) ──
 * Dicatat di level route SEBELUM/terlepas dari hasil, agar admin bisa bedakan:
 * (a) WAHA tak sampai (log kosong), (b) sampai tapi token salah, (c) sampai &
 * diproses tapi diabaikan (grup tak tertaut), (d) tersimpan. Simpan 10 terakhir. */
const WAHA_HITS = "waha.debug_hits";

export type WahaHit = {
  at: string;
  tokenOk: boolean;
  event: string;
  chatId: string | null;
  outcome: string;
};

export async function getWahaHits(): Promise<WahaHit[]> {
  const row = await db.appSetting.findFirst({
    where: { key: WAHA_HITS },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  if (!row) return [];
  try {
    const arr = JSON.parse(row.value);
    return Array.isArray(arr) ? (arr as WahaHit[]) : [];
  } catch {
    return [];
  }
}

/** Catat satu hit webhook (dipanggil di route untuk SETIAP POST). Simpan 10 terbaru. */
export async function recordWahaHit(hit: Omit<WahaHit, "at">): Promise<void> {
  const existing = await getWahaHits();
  const next = [{ ...hit, at: new Date().toISOString() }, ...existing].slice(0, 10);
  const effectiveFrom = jakartaToday();
  const value = JSON.stringify(next);
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key: WAHA_HITS, effectiveFrom } },
    update: { value },
    create: { key: WAHA_HITS, value, effectiveFrom },
  });
}

/**
 * Simpan konfigurasi WAHA (efektif hari ini). apiKey `undefined` = jangan ubah
 * (pertahankan yang lama); string kosong = hapus. baseUrl kosong = hapus.
 */
export async function setWahaConfig(input: {
  baseUrl?: string;
  apiKey?: string;
  session?: string;
  webhookSecret?: string;
  /** Buka/tutup pagar kiriman ke nomor pribadi (DECISIONS 433). */
  izinkanPersonal?: boolean;
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
  if (input.izinkanPersonal !== undefined) {
    await put(WAHA_KEYS.izinkanPersonal, input.izinkanPersonal ? "1" : "0");
  }
  if (input.session !== undefined) {
    await put(WAHA_KEYS.session, input.session.trim() || "default");
  }
  /*
   * apiKey & webhookSecret: TERENKRIPSI at-rest (audit 2026-08-28).
   *
   * Sampai audit itu keduanya ditulis apa adanya, sementara `ai/config.ts` dan
   * `gdrive/config.ts` mengenkripsi. Akibatnya terlihat di cadangan lapangan:
   * kredensial Google terenkripsi, `waha.api_key` dan `waha.webhook_secret`
   * telanjang — siapa pun yang memegang salinan basis data memegang kanal
   * WhatsApp-nya, dan webhook secret adalah yang membuktikan sebuah kiriman
   * benar-benar datang dari WAHA.
   *
   * String KOSONG tetap ditulis kosong (itu "hapus"), bukan dienkripsi:
   * ciphertext dari string kosong akan terbaca sebagai "masih ada key".
   */
  // apiKey: hanya tulis bila DIBERIKAN (undefined = biarkan). String kosong = hapus.
  if (input.apiKey !== undefined) {
    const v = input.apiKey.trim();
    await put(WAHA_KEYS.apiKey, v ? secretUntukSimpan(v) : "");
  }
  if (input.webhookSecret !== undefined) {
    const v = input.webhookSecret.trim();
    await put(WAHA_KEYS.webhookSecret, v ? secretUntukSimpan(v) : "");
  }
}
