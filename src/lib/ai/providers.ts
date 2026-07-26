/**
 * Metadata provider AI (MURNI — tanpa DB/server-only, aman dipakai klien).
 * MARLIN mendukung beberapa provider; admin memilih SATU yang aktif di Sistem.
 * Claude pakai Messages API Anthropic; OpenAI/Mistral/Grok kompatibel dengan
 * skema chat-completions OpenAI. DECISIONS 121.
 */

export type AiProviderId = "claude" | "openai" | "mistral" | "grok";
export type AiApiStyle = "anthropic" | "openai";

export type AiProviderMeta = {
  id: AiProviderId;
  label: string;
  apiStyle: AiApiStyle;
  /** Base URL endpoint (tanpa trailing slash). */
  baseUrl: string;
  defaultModel: string;
  /** Di mana mendapatkan API key. */
  keyHint: string;
  /** Untuk OpenAI, parameter batas token berbeda (max_completion_tokens). */
  tokenParam: "max_tokens" | "max_completion_tokens";
  /**
   * Saran model dari dokumentasi resmi (per 2026) — hint untuk dropdown. Daftar
   * OTORITATIF diambil live via endpoint /models provider (lihat listModels).
   */
  knownModels: string[];
};

export const AI_PROVIDERS: readonly AiProviderMeta[] = [
  {
    id: "claude",
    label: "Claude (Anthropic)",
    apiStyle: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-opus-5",
    keyHint: "console.anthropic.com → API keys",
    tokenParam: "max_tokens",
    knownModels: [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ],
  },
  {
    id: "openai",
    label: "ChatGPT (OpenAI)",
    apiStyle: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    keyHint: "platform.openai.com → API keys",
    tokenParam: "max_completion_tokens",
    knownModels: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o4-mini"],
  },
  {
    id: "mistral",
    label: "Mistral",
    apiStyle: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    keyHint: "console.mistral.ai → API Keys",
    tokenParam: "max_tokens",
    knownModels: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
      "magistral-medium-latest",
      "codestral-latest",
      "open-mistral-nemo",
    ],
  },
  {
    id: "grok",
    label: "Grok (xAI)",
    apiStyle: "openai",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4",
    keyHint: "console.x.ai → API Keys",
    tokenParam: "max_tokens",
    knownModels: ["grok-4", "grok-4-fast", "grok-3", "grok-3-mini", "grok-2-latest"],
  },
] as const;

export const AI_PROVIDER_IDS = AI_PROVIDERS.map((p) => p.id);

export function aiProvider(id: string): AiProviderMeta | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

export function isAiProviderId(id: string): id is AiProviderId {
  return AI_PROVIDER_IDS.includes(id as AiProviderId);
}
