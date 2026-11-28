import "server-only";
import type { ResolvedAiConfig } from "@/lib/ai/config";
import { zonaWaktu, MAKS_PENCARIAN_PER_PUTARAN } from "./aturan";
import { bacaHasilPencarian, webDimatikan, type HasilPencarian } from "./web-parse";

/**
 * RISET HARGA LEWAT PENCARIAN WEB – Messages API Anthropic + alat `web_search`
 * (DECISIONS 806).
 *
 * HTTP langsung, sama dengan seluruh klien AI MARLIN (`lib/ai/client.ts`,
 * DECISIONS 121) – bukan SDK: klien itu melayani empat provider lewat satu
 * jalur `fetch`, dan pencarian web hanya tambahan untuk provider Claude.
 *
 * Versi alatnya `web_search_20250305` (dasar), sengaja: berjalan di semua model
 * Claude yang bisa dipilih di Sistem → AI, termasuk yang lebih tua, tanpa blok
 * eksekusi kode yang menyertai penyaringan dinamis versi 2026. Harganya $10 per
 * 1.000 pencarian plus token hasil pencarian; `max_uses` membatasinya.
 *
 * `pause_turn` (putaran server terlalu panjang) dilanjutkan dengan mengirim
 * balik pesan asisten apa adanya, paling banyak tiga kali.
 */

const MAKS_LANJUTAN = 3;

export type HasilRisetWeb =
  | ({ ok: true } & HasilPencarian)
  | { ok: false; kode: "web_tidak_aktif" | "galat" | "waktu_habis"; error: string };

export type PermintaanRisetWeb = {
  system: string;
  prompt: string;
  lokasi: { provinsi: string; kabupaten: string };
  maxTokens?: number;
  timeoutMs?: number;
};

export function badanPermintaanWeb(cfg: Pick<ResolvedAiConfig, "model">, req: PermintaanRisetWeb, messages: unknown[]) {
  return {
    model: cfg.model,
    max_tokens: req.maxTokens ?? 8_000,
    system: req.system,
    messages,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: MAKS_PENCARIAN_PER_PUTARAN,
        user_location: {
          type: "approximate",
          country: "ID",
          region: req.lokasi.provinsi,
          city: req.lokasi.kabupaten,
          timezone: zonaWaktu(req.lokasi.provinsi),
        },
      },
    ],
  };
}

export async function risetWeb(
  cfg: ResolvedAiConfig,
  req: PermintaanRisetWeb,
  ambil: typeof fetch = fetch,
): Promise<HasilRisetWeb> {
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: req.prompt }];
  let hasil: HasilPencarian | undefined;
  for (let i = 0; i <= MAKS_LANJUTAN; i++) {
    let res: Response;
    try {
      res = await ambil(`${cfg.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(badanPermintaanWeb(cfg, req, messages)),
        signal: AbortSignal.timeout(req.timeoutMs ?? 240_000),
      });
    } catch (err) {
      const habis = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return { ok: false, kode: habis ? "waktu_habis" : "galat", error: habis ? "Pencarian web melewati batas waktu." : err instanceof Error ? err.message : "Pencarian web gagal." };
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 1_000);
      return {
        ok: false,
        kode: webDimatikan(res.status, body) ? "web_tidak_aktif" : "galat",
        error: `HTTP ${res.status}${body ? ` – ${body.slice(0, 300)}` : ""}`,
      };
    }
    const json = (await res.json().catch(() => null)) as { content?: unknown[]; stop_reason?: string } | null;
    hasil = bacaHasilPencarian(json, hasil);
    if (json?.stop_reason !== "pause_turn") break;
    // Lanjutkan putaran yang dijeda: kirim balik isi asisten APA ADANYA.
    messages.push({ role: "assistant", content: json.content ?? [] });
  }
  if (!hasil) return { ok: false, kode: "galat", error: "Respons pencarian web kosong." };
  return { ok: true, ...hasil };
}
