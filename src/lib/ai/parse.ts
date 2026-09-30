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
  | "billing"
  | "model_not_found"
  | "bad_request"
  | "input_too_big"
  | "truncated"
  | "provider_error"
  | "invalid_response"
  | "budget_exceeded"
  | "unknown";

/**
 * Kode galat dari status HTTP DAN isi respons (DECISIONS 635).
 *
 * Status saja menyesatkan tepat pada kasus yang paling penting: kuota habis
 * OpenAI datang sebagai 429 `insufficient_quota` (mengulangnya pasti gagal),
 * dan saldo habis Anthropic sebagai 400 (tanpa isi, terbaca "permintaan
 * salah" sehingga tidak dialihkan ke cadangan). Isi dibaca dulu, status
 * sesudahnya. Pola isi diambil dari pesan galat yang terdokumentasi provider;
 * yang tidak dikenali jatuh ke pemetaan status.
 */
export function kodeGalatAi(status: number, body = ""): AiErrorCode {
  const b = body.toLowerCase();
  if (status === 401 || status === 403) {
    return /billing|credit|payment|quota/.test(b) ? "billing" : "authentication";
  }
  if (status >= 400 && status < 500) {
    if (/insufficient_quota|credit balance|billing|payment required|exceeded your current quota|quota exceeded/.test(b)) {
      return "billing";
    }
    if (/model_not_found|model[^.]{0,60}(does not exist|not found|invalid)|invalid model|unknown model/.test(b)) {
      return "model_not_found";
    }
    if (/context length|context_length|too many tokens|prompt is too long|request_too_large|maximum context/.test(b)) {
      return "input_too_big";
    }
  }
  if (status === 402) return "billing";
  if (status === 404) return "model_not_found";
  if (status === 408) return "timeout";
  if (status === 413) return "input_too_big";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_error";
  if (status >= 400) return "bad_request";
  return "provider_error";
}

/** Kompatibel-mundur: pemetaan status tanpa isi. */
export function errorCodeFromStatus(status: number): AiErrorCode {
  return kodeGalatAi(status);
}

/** Galat sementara yang layak SATU retry pada provider yang sama. */
export function bolehDiulang(code: AiErrorCode): boolean {
  return code === "timeout" || code === "rate_limited" || code === "provider_error";
}

/**
 * Galat yang dialihkan ke provider cadangan (bila diatur). Permintaan yang
 * salah atau terlalu besar TIDAK: ia akan gagal juga di provider lain.
 */
export function bolehDialihkan(code: AiErrorCode): boolean {
  return (
    bolehDiulang(code) ||
    code === "billing" ||
    code === "model_not_found" ||
    code === "authentication" ||
    code === "unknown"
  );
}

/** Error sementara yang layak SATU retry (rate limit / 5xx). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Header `retry-after` (detik atau tanggal HTTP) → milidetik, dipotong 10 detik. */
export function retryAfterMs(raw: string | null | undefined, sekarang = Date.now()): number | null {
  if (!raw) return null;
  const v = raw.trim();
  let ms: number | null = null;
  if (/^\d+(\.\d+)?$/.test(v)) ms = Number(v) * 1000;
  else {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) ms = Math.max(0, t - sekarang);
  }
  return ms == null ? null : Math.min(ms, 10_000);
}

/** Jawaban dihentikan batas token keluaran (OpenAI/Mistral `length`, Claude `max_tokens`). */
export function terpotong(finishReason: string | null | undefined): boolean {
  return finishReason === "length" || finishReason === "max_tokens";
}
