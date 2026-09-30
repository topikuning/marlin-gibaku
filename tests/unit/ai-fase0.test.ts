/*
 * AI MARLIN FASE 0 – memulihkan jawaban yang gagal (DECISIONS 635).
 *
 * Spesifikasi "AI MARLIN Fase 0" (2026-09-30) + koreksi validasinya:
 *  - kode galat dibaca dari status DAN isi respons: kuota habis OpenAI datang
 *    sebagai 429 `insufficient_quota`, saldo habis Anthropic sebagai 400 –
 *    keduanya `billing`, bukan `rate_limited`/`bad_request`;
 *  - retry hanya untuk galat sementara, menghormati retry-after (≤ 10 dtk);
 *  - provider cadangan dipanggil sekali untuk galat akun/sementara, tidak untuk
 *    permintaan yang salah;
 *  - SATU tenggat total per pertanyaan mencakup retry, perbaikan, dan cadangan;
 *  - jawaban terpotong dikenali (`truncated`) dan perbaikannya meminta jawaban
 *    lebih pendek, membawa jawaban yang salah dan lampirannya;
 *  - tes koneksi memakai jalur JSON yang sungguhan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

type Cfg = {
  id: "mistral" | "openai" | "claude";
  apiStyle: "openai" | "anthropic";
  jalurPdf: "tidak_ada";
  baseUrl: string;
  tokenParam: "max_tokens";
  model: string;
  apiKey: string;
};
const cfg = (id: Cfg["id"]): Cfg => ({
  id,
  apiStyle: id === "claude" ? "anthropic" : "openai",
  jalurPdf: "tidak_ada",
  baseUrl: `https://${id}.contoh`,
  tokenParam: "max_tokens",
  model: `${id}-model`,
  apiKey: "k",
});

let aktif: Cfg | null = cfg("mistral");
let cadangan: Cfg | null = null;
vi.mock("@/lib/ai/config", () => ({
  getActiveAiConfig: async () => aktif,
  getFallbackAiConfig: async () => cadangan,
  getAiProviderConfig: async (id: Cfg["id"]) => cfg(id),
}));

const { kodeGalatAi, retryAfterMs } = await import("@/lib/ai/parse");
const { aiCall, aiCallWithConfig, testAiProvider } = await import("@/lib/ai/client");
const { aiStructured } = await import("@/lib/ai/structured");

type Jawab = { status: number; body: unknown; headers?: Record<string, string> };
let antrian: Record<string, Jawab[]> = {};
let permintaan: { host: string; body: Record<string, unknown> }[] = [];

function okOpenAi(text: string, finish = "stop"): Jawab {
  return {
    status: 200,
    body: { model: "m", choices: [{ message: { content: text }, finish_reason: finish }], usage: { prompt_tokens: 5, completion_tokens: 3 } },
  };
}

beforeEach(() => {
  aktif = cfg("mistral");
  cadangan = null;
  antrian = {};
  permintaan = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const host = new URL(url).host.split(".")[0];
    permintaan.push({ host, body: JSON.parse(String(init.body ?? "{}")) });
    const j = antrian[host]?.shift() ?? { status: 500, body: { error: "habis" } };
    return new Response(typeof j.body === "string" ? j.body : JSON.stringify(j.body), {
      status: j.status,
      headers: j.headers,
    });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("kode galat dari status DAN isi", () => {
  it.each([
    [400, "", "bad_request"],
    [422, "", "bad_request"],
    [401, "", "authentication"],
    [403, "", "authentication"],
    [402, "", "billing"],
    [404, "", "model_not_found"],
    [408, "", "timeout"],
    [413, "", "input_too_big"],
    [429, "", "rate_limited"],
    [500, "", "provider_error"],
    [529, '{"type":"overloaded_error"}', "provider_error"],
    // Kuota habis OpenAI: 429 tetapi TIDAK akan pulih dengan diulang.
    [429, '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}', "billing"],
    // Saldo habis Anthropic: 400 – harus tetap bisa dialihkan ke cadangan.
    [400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}', "billing"],
    [400, '{"error":{"message":"The model `mistral-x` does not exist"}}', "model_not_found"],
    [400, '{"error":{"message":"This model\'s maximum context length is 128000 tokens"}}', "input_too_big"],
  ])("HTTP %i %s → %s", (status, body, kode) => {
    expect(kodeGalatAi(status, body)).toBe(kode);
  });

  it("retry-after: detik atau tanggal, dipotong 10 detik", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs("120")).toBe(10_000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("bukan")).toBeNull();
  });
});

describe("retry hanya bila berguna", () => {
  it("400 hanya memanggil provider SEKALI", async () => {
    antrian.mistral = [{ status: 400, body: { error: "salah" } }];
    const r = await aiCallWithConfig(cfg("mistral") as never, { prompt: "x" });
    expect(r).toMatchObject({ ok: false, errorCode: "bad_request" });
    expect(permintaan).toHaveLength(1);
  });

  it("kuota habis (429 insufficient_quota) tidak diulang", async () => {
    antrian.mistral = [{ status: 429, body: { error: { code: "insufficient_quota" } } }];
    const r = await aiCallWithConfig(cfg("mistral") as never, { prompt: "x" });
    expect(r).toMatchObject({ ok: false, errorCode: "billing" });
    expect(permintaan).toHaveLength(1);
  });

  it("429 biasa diulang sekali, menghormati retry-after", async () => {
    antrian.mistral = [{ status: 429, body: "lambat", headers: { "retry-after": "0" } }, okOpenAi("halo")];
    const r = await aiCallWithConfig(cfg("mistral") as never, { prompt: "x" });
    expect(r).toMatchObject({ ok: true, text: "halo" });
    expect(permintaan).toHaveLength(2);
  });

  it("tenggat total yang hampir habis → tidak mengulang", async () => {
    antrian.mistral = [{ status: 500, body: "x" }, okOpenAi("halo")];
    const r = await aiCallWithConfig(cfg("mistral") as never, { prompt: "x", tenggatAt: Date.now() + 3_000 });
    expect(r.ok).toBe(false);
    expect(permintaan).toHaveLength(1);
  });
});

describe("provider cadangan", () => {
  it("utama selalu 429 → jawaban dari cadangan, asalnya tercatat", async () => {
    cadangan = cfg("openai");
    antrian.mistral = [
      { status: 429, body: "x", headers: { "retry-after": "0" } },
      { status: 429, body: "x", headers: { "retry-after": "0" } },
    ];
    antrian.openai = [okOpenAi("dari cadangan")];
    const r = await aiCall({ prompt: "x" });
    expect(r).toMatchObject({ ok: true, provider: "openai", text: "dari cadangan", fallbackFrom: "mistral" });
  });

  it("saldo habis Anthropic (400) tetap dialihkan", async () => {
    aktif = cfg("claude");
    cadangan = cfg("openai");
    antrian.claude = [{ status: 400, body: { error: { message: "Your credit balance is too low" } } }];
    antrian.openai = [okOpenAi("ok")];
    const r = await aiCall({ prompt: "x" });
    expect(r).toMatchObject({ ok: true, provider: "openai", fallbackFrom: "claude" });
  });

  it("permintaan yang salah (bad_request) TIDAK dialihkan", async () => {
    cadangan = cfg("openai");
    antrian.mistral = [{ status: 400, body: { error: "skema salah" } }];
    const r = await aiCall({ prompt: "x" });
    expect(r).toMatchObject({ ok: false, errorCode: "bad_request" });
    expect(permintaan.map((p) => p.host)).toEqual(["mistral"]);
  });

  it("tanpa setelan cadangan → perilaku lama", async () => {
    antrian.mistral = [{ status: 402, body: "bayar" }];
    const r = await aiCall({ prompt: "x" });
    expect(r).toMatchObject({ ok: false, errorCode: "billing", provider: "mistral" });
    expect(permintaan).toHaveLength(1);
  });
});

describe("jawaban terstruktur", () => {
  const skema = z.object({ bagian: z.array(z.string()) });

  it("jawaban terpotong → perbaikan meminta lebih pendek dan membawa jawaban yang salah", async () => {
    antrian.mistral = [okOpenAi('{"bagian":["satu","du', "length"), okOpenAi('{"bagian":["satu"]}')];
    const r = await aiStructured(skema, { prompt: "tanya", schemaHint: "{}" });
    expect(r.ok).toBe(true);
    const perbaikan = JSON.stringify(permintaan[1].body);
    expect(perbaikan).toMatch(/lebih pendek/i);
    expect(perbaikan).toContain('{\\"bagian\\":[\\"satu\\",\\"du');
  });

  it("tetap terpotong sesudah perbaikan → kode truncated", async () => {
    antrian.mistral = [okOpenAi('{"bagian":["a', "length"), okOpenAi('{"bagian":["b', "length")];
    const r = await aiStructured(skema, { prompt: "tanya", schemaHint: "{}" });
    expect(r).toMatchObject({ ok: false, errorCode: "truncated" });
  });

  it("perbaikan JSON ikut membawa lampiran aslinya", async () => {
    antrian.mistral = [okOpenAi("bukan json"), okOpenAi('{"bagian":[]}')];
    const lampiran = [{ mediaType: "image/png", dataBase64: "QUJD", nama: "a.png" }];
    await aiStructured(skema, { prompt: "tanya", schemaHint: "{}", attachments: lampiran as never });
    expect(JSON.stringify(permintaan[1].body)).toContain("QUJD");
  });
});

describe("tes koneksi memakai jalur JSON sungguhan", () => {
  it("model yang hanya membalas teks → merah", async () => {
    antrian.mistral = [okOpenAi("OK")];
    const r = await testAiProvider("mistral");
    expect(r.ok).toBe(false);
  });

  it('model yang membalas {"ok": true} → hijau, dengan latensi', async () => {
    antrian.mistral = [okOpenAi('{"ok": true}')];
    const r = await testAiProvider("mistral");
    expect(r).toMatchObject({ ok: true });
    expect(permintaan[0].body.max_tokens).toBeGreaterThanOrEqual(1_000);
  });
});
