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
  },
  {
    id: "openai",
    label: "ChatGPT (OpenAI)",
    apiStyle: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    keyHint: "platform.openai.com → API keys",
    tokenParam: "max_completion_tokens",
  },
  {
    id: "mistral",
    label: "Mistral",
    apiStyle: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    keyHint: "console.mistral.ai → API Keys",
    tokenParam: "max_tokens",
  },
  {
    id: "grok",
    label: "Grok (xAI)",
    apiStyle: "openai",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4",
    keyHint: "console.x.ai → API Keys",
    tokenParam: "max_tokens",
  },
] as const;

export const AI_PROVIDER_IDS = AI_PROVIDERS.map((p) => p.id);

export function aiProvider(id: string): AiProviderMeta | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

export function isAiProviderId(id: string): id is AiProviderId {
  return AI_PROVIDER_IDS.includes(id as AiProviderId);
}
