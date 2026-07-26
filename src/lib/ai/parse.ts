/**
 * Parser respons provider AI — MURNI (tanpa fetch/server-only) supaya unit-testable.
 * Anthropic Messages API & skema chat-completions kompatibel-OpenAI (OpenAI/
 * Mistral/Grok). Menangkap text + usage token + finish reason. DECISIONS 133.
 */

export type AiUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type ParsedAiBody = {
  text: string;
  model: string | null;
  usage: AiUsage;
  finishReason: string | null;
};

function toInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/** Anthropic Messages API: content[].text, usage.input_tokens/output_tokens, stop_reason. */
export function parseAnthropicBody(json: unknown): ParsedAiBody {
  const j = (json ?? {}) as {
    model?: string;
    content?: { type?: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string;
  };
  const text = (j.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  return {
    text,
    model: typeof j.model === "string" ? j.model : null,
    usage: {
      inputTokens: toInt(j.usage?.input_tokens),
      outputTokens: toInt(j.usage?.output_tokens),
    },
    finishReason: typeof j.stop_reason === "string" ? j.stop_reason : null,
  };
}

/** OpenAI-compatible chat completions: choices[0].message.content, usage.prompt/completion_tokens. */
export function parseOpenAiBody(json: unknown): ParsedAiBody {
  const j = (json ?? {}) as {
    model?: string;
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const first = j.choices?.[0];
  return {
    text: first?.message?.content?.trim() ?? "",
    model: typeof j.model === "string" ? j.model : null,
    usage: {
      inputTokens: toInt(j.usage?.prompt_tokens),
      outputTokens: toInt(j.usage?.completion_tokens),
    },
    finishReason: typeof first?.finish_reason === "string" ? first.finish_reason : null,
  };
}

/**
 * Ekstrak blok JSON dari teks model: buang code fence, ambil objek/array
 * seimbang pertama. Null bila tak ada kandidat JSON.
 */
export function extractJsonBlock(text: string): string | null {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = inStr;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return null;
}

export type AiErrorCode =
  | "provider_disabled"
  | "timeout"
  | "rate_limited"
  | "authentication"
  | "provider_error"
  | "invalid_response"
  | "budget_exceeded"
  | "unknown";

/** Petakan status HTTP provider → kode error stabil. */
export function errorCodeFromStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_error";
  return "provider_error";
}

/** Error sementara yang layak SATU retry (rate limit / 5xx). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
