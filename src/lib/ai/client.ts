import "server-only";
import { getActiveAiConfig, getAiProviderConfig, getFallbackAiConfig, type ResolvedAiConfig } from "./config";
import type { AiProviderId } from "./providers";
export {
  dukunganLampiran,
  kontenAnthropic,
  kontenOpenAi,
  type AiAttachment,
  type AiRequest,
  type DukunganLampiran,
} from "./lampiran";
import { kontenAnthropic, kontenOpenAi, type AiRequest } from "./lampiran";
import {
  bolehDialihkan,
  bolehDiulang,
  extractJsonBlock,
  kodeGalatAi,
  parseAnthropicBody,
  retryAfterMs,
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
 * Respons mentah provider TIDAK dilog; API key tidak pernah ikut pesan error.
 */

export type AiResult = { ok: true; text: string; model: string } | { ok: false; error: string };

export type AiCallResult =
  | {
      ok: true;
      provider: AiProviderId;
      model: string;
      text: string;
      usage: AiUsage;
      latencyMs: number;
      finishReason: string | null;
      /** Provider UTAMA yang gagal sehingga jawaban ini datang dari cadangan. */
      fallbackFrom?: AiProviderId | null;
    }
  | {
      ok: false;
      provider: AiProviderId | null;
      model: string | null;
      errorCode: AiErrorCode;
      error: string;
      latencyMs: number;
      /** Cadangan yang ikut dicoba lalu gagal juga (utama tetap di `provider`). */
      cadanganGagal?: AiProviderId | null;
      /** Jeda yang diminta provider (header retry-after), milidetik. */
      retryAfterMs?: number | null;
    };

const DEFAULT_TIMEOUT_MS = 60_000;
/** Sisa tenggat di bawah ini tidak dipakai untuk memanggil provider lagi. */
const SISA_MINIMUM_MS = 2_000;
const JEDA_RETRY_MS = 1_500;

const sisaTenggat = (req: AiRequest) => (req.tenggatAt == null ? Infinity : req.tenggatAt - Date.now());

async function readError(res: Response): Promise<string> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  return `HTTP ${res.status}${body ? ` – ${body}` : ""}`;
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
          messages: [{ role: "user", content: kontenAnthropic(req) }],
        }),
      },
    };
  }
  const messages: { role: string; content: unknown }[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: kontenOpenAi(req, cfg.jalurPdf) });
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
  const sisa = sisaTenggat(req);
  if (sisa < SISA_MINIMUM_MS) {
    return {
      ok: false,
      provider: cfg.id,
      model: cfg.model,
      errorCode: "timeout",
      error: "Tenggat jawaban habis sebelum provider AI sempat dipanggil.",
      latencyMs: 0,
    };
  }
  const { url, init } = buildRequest(cfg, req);
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(Math.min(req.timeoutMs ?? DEFAULT_TIMEOUT_MS, sisa)),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      // Isi dibaca SEKALI: dipakai untuk kode galat (kuota vs rate limit) dan pesannya.
      const body = (await res.text().catch(() => "")).slice(0, 2_000);
      return {
        ok: false,
        provider: cfg.id,
        model: cfg.model,
        errorCode: kodeGalatAi(res.status, body),
        error: `HTTP ${res.status}${body ? ` – ${body.slice(0, 300)}` : ""}`,
        latencyMs,
        retryAfterMs: retryAfterMs(res.headers.get("retry-after")),
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

/**
 * Panggil provider dgn config eksplisit: timeout + maksimal SATU retry, HANYA
 * untuk galat sementara (timeout/rate limit/5xx) dan hanya bila tenggat total
 * masih cukup. Jeda mengikuti retry-after provider (maks 10 dtk). DECISIONS 635.
 */
export async function aiCallWithConfig(cfg: ResolvedAiConfig, req: AiRequest): Promise<AiCallResult> {
  const first = await callOnce(cfg, req);
  if (first.ok || !bolehDiulang(first.errorCode)) return first;
  const jeda = first.retryAfterMs ?? JEDA_RETRY_MS;
  if (sisaTenggat(req) - jeda < SISA_MINIMUM_MS) return first;
  await new Promise((r) => setTimeout(r, jeda));
  const second = await callOnce(cfg, req);
  return second.ok ? second : { ...second, latencyMs: first.latencyMs + second.latencyMs };
}

/**
 * Panggil provider AKTIF — hasil lengkap (usage/latency/error code). Dipakai AI Hub.
 *
 * Bila provider utama gagal karena akun/galat sementara dan provider CADANGAN
 * diatur, cadangan dipanggil sekali (DECISIONS 635). Permintaan yang salah
 * tidak dialihkan – ia akan gagal juga di sana. Jawaban dari cadangan membawa
 * `fallbackFrom` supaya Riwayat memperlihatkan keduanya.
 */
export async function aiCall(req: AiRequest): Promise<AiCallResult> {
  const cfg = await getActiveAiConfig();
  if (!cfg) {
    return {
      ok: false,
      provider: null,
      model: null,
      errorCode: "provider_disabled",
      error: "Provider AI aktif belum siap – pilih provider & isi API key di Sistem → AI.",
      latencyMs: 0,
    };
  }
  const utama = await aiCallWithConfig(cfg, req);
  if (utama.ok || !bolehDialihkan(utama.errorCode)) return utama;
  if (sisaTenggat(req) < SISA_MINIMUM_MS) return utama;
  const cadangan = await getFallbackAiConfig();
  if (!cadangan || cadangan.id === cfg.id) return utama;
  const hasil = await aiCallWithConfig(cadangan, req);
  const latencyMs = utama.latencyMs + hasil.latencyMs;
  if (hasil.ok) return { ...hasil, latencyMs, fallbackFrom: cfg.id };
  return {
    ...utama,
    latencyMs,
    cadanganGagal: cadangan.id,
    error: `${utama.error} · cadangan ${cadangan.id} juga gagal: ${hasil.error}`.slice(0, 1_000),
  };
}

export type HasilTesKoneksi =
  | { ok: true; text: string; model: string; latencyMs: number }
  | { ok: false; error: string; errorCode?: AiErrorCode; latencyMs?: number };

/**
 * Tes koneksi yang menguji JALUR SUNGGUHAN (DECISIONS 635): minta JSON kecil
 * dengan batas token sebesar pemakaian nyata, lewat model yang tersimpan.
 * Tes lama cuma meminta "OK" dalam 16 token – bisa hijau padahal jalur JSON
 * yang dipakai fitur gagal.
 */
export async function testAiProvider(id: AiProviderId): Promise<HasilTesKoneksi> {
  const cfg = await getAiProviderConfig(id);
  if (!cfg) return { ok: false, error: "API key provider ini belum diisi." };
  const r = await aiCallWithConfig(cfg, {
    system: "Balas HANYA dengan objek JSON yang valid, tanpa teks lain.",
    prompt: 'Kirim tepat objek JSON ini: {"ok": true}',
    maxTokens: 3_000,
    timeoutMs: 30_000,
  });
  if (!r.ok) return { ok: false, error: r.error, errorCode: r.errorCode, latencyMs: r.latencyMs };
  let okJson = false;
  try {
    okJson = (JSON.parse(extractJsonBlock(r.text) ?? "null") as { ok?: unknown } | null)?.ok === true;
  } catch {
    okJson = false;
  }
  if (!okJson) {
    return {
      ok: false,
      errorCode: "invalid_response",
      latencyMs: r.latencyMs,
      error: `Model ${r.model} membalas, tetapi bukan JSON yang diminta ("${r.text.slice(0, 80)}") – fitur AI akan gagal. Ganti model.`,
    };
  }
  return { ok: true, text: r.text, model: r.model, latencyMs: r.latencyMs };
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
