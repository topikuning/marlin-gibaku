/**
 * Metadata provider AI (MURNI — tanpa DB/server-only, aman dipakai klien).
 * MARLIN mendukung beberapa provider; admin memilih SATU yang aktif di Sistem.
 * Claude pakai Messages API Anthropic; OpenAI/Mistral/Grok kompatibel dengan
 * skema chat-completions OpenAI. DECISIONS 121.
 */

export type AiProviderId = "claude" | "openai" | "mistral" | "grok";
export type AiApiStyle = "anthropic" | "openai";

/**
 * Cara mengirim PDF ke provider (DECISIONS 435). `apiStyle` TIDAK cukup:
 * OpenAI, Mistral, dan Grok sama-sama "kompatibel-OpenAI" untuk teks, tapi
 * bentuk medan berkasnya berbeda-beda. Diverifikasi ke tipe SDK resmi
 * masing-masing, bukan dari ingatan — lihat catatan per nilai.
 */
export type JalurPdf =
  /** Anthropic /v1/messages: `{type:"document", source:{type:"base64", media_type, data}}`. */
  | "anthropic_document"
  /**
   * OpenAI chat-completions: `{type:"file", file:{filename, file_data}}`.
   * Terverifikasi di tipe SDK resmi `openai` 7.5.0 —
   * `ChatCompletionContentPart.File` (`file_data` = "base64 encoded file data").
   */
  | "openai_file"
  /**
   * Mistral chat-completions: `{type:"document_url", document_url:"data:application/pdf;base64,…"}`.
   * Terverifikasi di tipe SDK resmi `@mistralai/mistralai` 2.6.4 —
   * `DocumentURLChunk` di union `ContentChunk`.
   */
  | "mistral_document_url"
  /**
   * xAI/Grok: PDF TIDAK bisa disisipkan langsung di pesan. Berkas harus
   * diunggah dulu lewat Files API lalu dirujuk `attachments:[{file_id}]` —
   * alur dua langkah yang MARLIN belum bangun. Ini keterangan tentang bentuk
   * API-nya, bukan klaim bahwa Grok tidak mampu membaca PDF.
   */
  | "unggah_dulu";

export type AiProviderMeta = {
  id: AiProviderId;
  label: string;
  apiStyle: AiApiStyle;
  /** Bentuk medan untuk menyisipkan PDF (DECISIONS 435). */
  jalurPdf: JalurPdf;
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
    jalurPdf: "anthropic_document",
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
    jalurPdf: "openai_file",
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
    jalurPdf: "mistral_document_url",
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
    jalurPdf: "unggah_dulu",
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
