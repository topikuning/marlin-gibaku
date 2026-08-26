import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { jakartaToday } from "@/lib/format";
import { encryptionKeyFromEnv, encryptSecret, readStoredSecret } from "@/lib/ai/crypto";
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  aiProvider,
  isAiProviderId,
  type AiApiStyle,
  type JalurPdf,
  type AiProviderId,
} from "./providers";

/**
 * Konfigurasi provider AI sebagai SETTING APLIKASI (AppSetting, effective-dated)
 * — bukan environment. Admin mengatur per provider (API key + model) & memilih
 * provider aktif di Sistem, tanpa redeploy. API key rahasia (server-only).
 * DECISIONS 121.
 */

const ACTIVE_KEY = "ai.active_provider";
const keyApiKey = (id: string) => `ai.${id}.api_key`;
const keyModel = (id: string) => `ai.${id}.model`;

function allKeys(): string[] {
  return [ACTIVE_KEY, ...AI_PROVIDER_IDS.flatMap((id) => [keyApiKey(id), keyModel(id)])];
}

/** Nilai efektif terbaru per key. */
export async function latestSettings(keys: string[]): Promise<Map<string, string>> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: keys } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  const latest = new Map<string, string>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r.value);
  return latest;
}

export async function putAiSetting(key: string, value: string): Promise<void> {
  const effectiveFrom = jakartaToday();
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key, effectiveFrom } },
    update: { value },
    create: { key, value, effectiveFrom },
  });
}
const put = putAiSetting;

export type AiProviderDisplay = {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  keyHint: string;
  hasApiKey: boolean;
  model: string;
  knownModels: string[];
};

export type AiConfigDisplay = {
  activeProvider: AiProviderId | null;
  providers: AiProviderDisplay[];
};

/** Untuk tampilan Sistem: status tiap provider + provider aktif (tanpa bocorkan key). */
export async function getAiConfigDisplay(): Promise<AiConfigDisplay> {
  const s = await latestSettings(allKeys());
  const active = s.get(ACTIVE_KEY)?.trim();
  return {
    activeProvider: active && isAiProviderId(active) ? active : null,
    providers: AI_PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      defaultModel: p.defaultModel,
      keyHint: p.keyHint,
      hasApiKey: !!s.get(keyApiKey(p.id))?.trim(),
      model: s.get(keyModel(p.id))?.trim() || p.defaultModel,
      knownModels: p.knownModels,
    })),
  };
}

/** Status penyimpanan rahasia (untuk tampilan Sistem — tanpa bocorkan kunci/nilai). */
export function aiSecretStorageStatus(): { encrypted: boolean; detail: string } {
  const key = encryptionKeyFromEnv();
  if (key) return { encrypted: true, detail: "API key dienkripsi at-rest (AES-256-GCM)." };
  return {
    encrypted: false,
    detail:
      env.APP_ENV === "production"
        ? "AI_SECRET_ENCRYPTION_KEY belum diset – penyimpanan API key baru DITOLAK di production."
        : "AI_SECRET_ENCRYPTION_KEY belum diset – API key tersimpan plaintext (hanya boleh di dev).",
  };
}

/** Simpan API key & model satu provider. apiKey `undefined` = jangan ubah; "" = hapus. */
export async function setAiProviderConfig(
  id: AiProviderId,
  input: { apiKey?: string; model?: string },
): Promise<void> {
  if (input.model !== undefined) {
    await put(keyModel(id), input.model.trim());
  }
  if (input.apiKey !== undefined) {
    const plain = input.apiKey.trim();
    if (plain === "") {
      await put(keyApiKey(id), "");
      return;
    }
    const key = encryptionKeyFromEnv();
    if (key) {
      await put(keyApiKey(id), encryptSecret(plain, key));
    } else if (env.APP_ENV === "production") {
      // Jangan pernah diam-diam menyimpan plaintext baru di production.
      throw new Error(
        "AI_SECRET_ENCRYPTION_KEY belum diset di server – API key tidak disimpan. Set env tersebut lalu ulangi.",
      );
    } else {
      await put(keyApiKey(id), plain); // dev/test: transisi, tetap jalan
    }
  }
}

/** Set provider aktif (harus sudah punya API key — divalidasi di action). */
export async function setActiveAiProvider(id: AiProviderId): Promise<void> {
  await put(ACTIVE_KEY, id);
}

export type ResolvedAiConfig = {
  id: AiProviderId;
  apiStyle: AiApiStyle;
  jalurPdf: JalurPdf;
  baseUrl: string;
  tokenParam: "max_tokens" | "max_completion_tokens";
  model: string;
  apiKey: string;
};

/** Config satu provider (untuk tes koneksi) — null bila API key belum ada. */
export async function getAiProviderConfig(id: AiProviderId): Promise<ResolvedAiConfig | null> {
  const meta = aiProvider(id);
  if (!meta) return null;
  const s = await latestSettings([keyApiKey(id), keyModel(id)]);
  const stored = s.get(keyApiKey(id))?.trim();
  // Kompatibel-mundur: plaintext lama terbaca apa adanya; terenkripsi didekripsi.
  const apiKey = stored ? readStoredSecret(stored, encryptionKeyFromEnv())?.trim() : undefined;
  if (!apiKey) return null;
  return {
    id,
    apiStyle: meta.apiStyle,
    jalurPdf: meta.jalurPdf,
    baseUrl: meta.baseUrl,
    tokenParam: meta.tokenParam,
    model: s.get(keyModel(id))?.trim() || meta.defaultModel,
    apiKey,
  };
}

/** Config provider AKTIF (untuk fitur AI mis. ringkasan) — null bila belum siap. */
export async function getActiveAiConfig(): Promise<ResolvedAiConfig | null> {
  const s = await latestSettings([ACTIVE_KEY]);
  const active = s.get(ACTIVE_KEY)?.trim();
  if (!active || !isAiProviderId(active)) return null;
  return getAiProviderConfig(active);
}
