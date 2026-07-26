import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  aiProvider,
  isAiProviderId,
  type AiApiStyle,
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
async function latestSettings(keys: string[]): Promise<Map<string, string>> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: keys } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  const latest = new Map<string, string>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r.value);
  return latest;
}

async function put(key: string, value: string): Promise<void> {
  const effectiveFrom = jakartaToday();
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key, effectiveFrom } },
    update: { value },
    create: { key, value, effectiveFrom },
  });
}

export type AiProviderDisplay = {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  keyHint: string;
  hasApiKey: boolean;
  model: string;
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
    })),
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
    await put(keyApiKey(id), input.apiKey.trim());
  }
}

/** Set provider aktif (harus sudah punya API key — divalidasi di action). */
export async function setActiveAiProvider(id: AiProviderId): Promise<void> {
  await put(ACTIVE_KEY, id);
}

export type ResolvedAiConfig = {
  id: AiProviderId;
  apiStyle: AiApiStyle;
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
  const apiKey = s.get(keyApiKey(id))?.trim();
  if (!apiKey) return null;
  return {
    id,
    apiStyle: meta.apiStyle,
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
