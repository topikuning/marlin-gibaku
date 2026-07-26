import "server-only";
import { getActiveAiConfig, getAiProviderConfig, type ResolvedAiConfig } from "./config";
import type { AiProviderId } from "./providers";

/**
 * Klien AI TERPADU untuk semua provider. Claude → Messages API Anthropic;
 * OpenAI/Mistral/Grok → chat-completions kompatibel-OpenAI. Fitur AI (mis.
 * ringkasan percakapan WA) cukup panggil `aiComplete()` — provider aktif dipilih
 * di Sistem. Butuh egress ke host provider dari server. DECISIONS 121.
 */

export type AiResult = { ok: true; text: string; model: string } | { ok: false; error: string };

export type AiRequest = { system?: string; prompt: string; maxTokens?: number };

async function readError(res: Response): Promise<string> {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  return `HTTP ${res.status}${body ? ` — ${body}` : ""}`;
}

async function callProvider(cfg: ResolvedAiConfig, req: AiRequest): Promise<AiResult> {
  const maxTokens = req.maxTokens ?? 1024;
  try {
    if (cfg.apiStyle === "anthropic") {
      const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
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
      });
      if (!res.ok) return { ok: false, error: await readError(res) };
      const json = (await res.json()) as {
        model?: string;
        content?: { type: string; text?: string }[];
      };
      const text = (json.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
        .trim();
      return { ok: true, text, model: json.model ?? cfg.model };
    }

    // OpenAI-compatible (OpenAI, Mistral, Grok)
    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        [cfg.tokenParam]: maxTokens,
        messages,
      }),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    const json = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    return { ok: true, text, model: json.model ?? cfg.model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "gagal memanggil provider AI" };
  }
}

/** Panggil provider AI AKTIF. Dipakai fitur AI (ringkasan, dsb.). */
export async function aiComplete(req: AiRequest): Promise<AiResult> {
  const cfg = await getActiveAiConfig();
  if (!cfg) {
    return {
      ok: false,
      error: "Provider AI aktif belum siap — pilih provider & isi API key di Sistem → AI.",
    };
  }
  return callProvider(cfg, req);
}

/** Tes koneksi satu provider (minimal request) untuk verifikasi API key/model. */
export async function testAiProvider(id: AiProviderId): Promise<AiResult> {
  const cfg = await getAiProviderConfig(id);
  if (!cfg) return { ok: false, error: "API key provider ini belum diisi." };
  return callProvider(cfg, { prompt: "Balas satu kata: OK", maxTokens: 16 });
}
