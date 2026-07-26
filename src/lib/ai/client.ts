import "server-only";
import { getActiveAiConfig, getAiProviderConfig, type ResolvedAiConfig } from "./config";
import type { AiProviderId } from "./providers";
import {
  errorCodeFromStatus,
  parseAnthropicBody,
  parseOpenAiBody,
  type AiErrorCode,
  type AiUsage,
} from "./parse";

/**
 * Klien AI TERPADU untuk semua provider. Claude → Messages API Anthropic;
 * OpenAI/Mistral/Grok → chat-completions kompatibel-OpenAI. DECISIONS 121.
 *
 * v2 (AI Hub, DECISIONS 133): `aiCall()` mengembalikan hasil LENGKAP —
 * usage token, latency, finish reason, kode error stabil — dengan timeout
 * (AbortSignal) + maksimal SATU retry untuk error sementara (429/5xx/timeout).
 * `aiComplete()` lama dipertahankan sebagai pembungkus tipis (kompatibel).
 * Respons mentah provider TIDAK dilog; API key tidak pernah ikut pesan error.
 */

export type AiResult = { ok: true; text: string; model: string } | { ok: false; error: string };

export type AiRequest = { system?: string; prompt: string; maxTokens?: number; timeoutMs?: number };

export type AiCallResult =
  | {
      ok: true;
      provider: AiProviderId;
      model: string;
      text: string;
      usage: AiUsage;
      latencyMs: number;
      finishReason: string | null;
    }
  | {
      ok: false;
      provider: AiProviderId | null;
      model: string | null;
      errorCode: AiErrorCode;
      error: string;
      latencyMs: number;
    };

const DEFAULT_TIMEOUT_MS = 60_000;

async function readError(res: Response): Promise<string> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  return `HTTP ${res.status}${body ? ` — ${body}` : ""}`;
}

function buildRequest(cfg: ResolvedAiConfig, req: AiRequest): { url: string; init: RequestInit } {
  const maxTokens = req.maxTokens ?? 1024;
  if (cfg.apiStyle === "anthropic") {
    return {
      url: `${cfg.baseUrl}/v1/messages`,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          ...(req.system ? { system: req.system } : {}),
          messages: [{ role: "user", content: req.prompt }],
        }),
      },
    };
  }
  const messages: { role: string; content: string }[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: req.prompt });
  return {
    url: `${cfg.baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, [cfg.tokenParam]: maxTokens, messages }),
    },
  };
}

async function callOnce(cfg: ResolvedAiConfig, req: AiRequest): Promise<AiCallResult> {
  const started = Date.now();
  const { url, init } = buildRequest(cfg, req);
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        provider: cfg.id,
        model: cfg.model,
        errorCode: errorCodeFromStatus(res.status),
        error: await readError(res),
        latencyMs,
      };
    }
    const json: unknown = await res.json().catch(() => null);
    const parsed = cfg.apiStyle === "anthropic" ? parseAnthropicBody(json) : parseOpenAiBody(json);
    if (!parsed.text) {
      return {
        ok: false,
        provider: cfg.id,
        model: parsed.model ?? cfg.model,
        errorCode: "invalid_response",
        error: "Provider mengembalikan respons kosong.",
        latencyMs,
      };
    }
    return {
      ok: true,
      provider: cfg.id,
      model: parsed.model ?? cfg.model,
      text: parsed.text,
      usage: parsed.usage,
      latencyMs,
      finishReason: parsed.finishReason,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      provider: cfg.id,
      model: cfg.model,
      errorCode: isTimeout ? "timeout" : "unknown",
      error: isTimeout
        ? "Provider AI tidak merespons dalam batas waktu."
        : err instanceof Error
          ? err.message
          : "gagal memanggil provider AI",
      latencyMs,
    };
  }
}

/** Panggil provider dgn config eksplisit: timeout + maksimal SATU retry (429/5xx/timeout). */
export async function aiCallWithConfig(cfg: ResolvedAiConfig, req: AiRequest): Promise<AiCallResult> {
  const first = await callOnce(cfg, req);
  if (first.ok) return first;
  const retryable =
    first.errorCode === "timeout" ||
    first.errorCode === "rate_limited" ||
    first.errorCode === "provider_error";
  if (!retryable) return first;
  await new Promise((r) => setTimeout(r, 1500));
  const second = await callOnce(cfg, req);
  return second.ok ? second : { ...second, latencyMs: first.latencyMs + second.latencyMs };
}

/** Panggil provider AKTIF — hasil lengkap (usage/latency/error code). Dipakai AI Hub. */
export async function aiCall(req: AiRequest): Promise<AiCallResult> {
  const cfg = await getActiveAiConfig();
  if (!cfg) {
    return {
      ok: false,
      provider: null,
      model: null,
      errorCode: "provider_disabled",
      error: "Provider AI aktif belum siap — pilih provider & isi API key di Sistem → AI.",
      latencyMs: 0,
    };
  }
  return aiCallWithConfig(cfg, req);
}

/** Panggil provider AI AKTIF (kompatibel lama — dipakai laporan eksekutif WA). */
export async function aiComplete(req: AiRequest): Promise<AiResult> {
  const r = await aiCall(req);
  return r.ok ? { ok: true, text: r.text, model: r.model } : { ok: false, error: r.error };
}

/** Tes koneksi satu provider (minimal request) untuk verifikasi API key/model. */
export async function testAiProvider(id: AiProviderId): Promise<AiResult> {
  const cfg = await getAiProviderConfig(id);
  if (!cfg) return { ok: false, error: "API key provider ini belum diisi." };
  const r = await aiCallWithConfig(cfg, { prompt: "Balas satu kata: OK", maxTokens: 16, timeoutMs: 20_000 });
  return r.ok ? { ok: true, text: r.text, model: r.model } : { ok: false, error: r.error };
}

export type AiModelsResult = { ok: true; models: string[] } | { ok: false; error: string };

/**
 * Ambil daftar model OTORITATIF langsung dari endpoint /models provider (sumber
 * paling kredibel & selalu terkini). Anthropic: GET /v1/models; OpenAI/Mistral/
 * Grok: GET {baseUrl}/models. Butuh API key tersimpan + egress.
 */
export async function listModels(id: AiProviderId): Promise<AiModelsResult> {
  const cfg = await getAiProviderConfig(id);
  if (!cfg) return { ok: false, error: "API key provider ini belum diisi." };
  try {
    const url = cfg.apiStyle === "anthropic" ? `${cfg.baseUrl}/v1/models` : `${cfg.baseUrl}/models`;
    const headers: Record<string, string> =
      cfg.apiStyle === "anthropic"
        ? { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" }
        : { authorization: `Bearer ${cfg.apiKey}` };
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { ok: false, error: await readError(res) };
    const json = (await res.json()) as { data?: { id?: string }[] };
    const models = (json.data ?? [])
      .map((m) => m.id)
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .sort((a, b) => a.localeCompare(b));
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "gagal mengambil daftar model" };
  }
}
