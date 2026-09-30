import "server-only";
import type { z } from "zod";
import { aiCall, type AiCallResult, type AiRequest } from "./client";
import { extractJsonBlock, terpotong } from "./parse";

/**
 * Panggilan AI TERSTRUKTUR: instruksi JSON-only → ekstrak blok JSON → validasi
 * zod. Bila gagal parse/validasi: MAKSIMAL SATU percobaan perbaikan (kirim error
 * zod ke model). AI Hub selalu lewat sini — output bebas-format tidak diterima.
 * DECISIONS 133.
 */

export type AiStructuredResult<T> =
  | { ok: true; data: T; meta: Extract<AiCallResult, { ok: true }>; attempts: number }
  | { ok: false; errorCode: string; error: string; meta: AiCallResult | null; attempts: number };

const JSON_RULES =
  "Jawab HANYA dengan satu objek JSON valid sesuai skema yang diminta – tanpa penjelasan, tanpa markdown, tanpa teks lain di luar JSON.";

function tryParse<T>(schema: z.ZodType<T>, text: string): { data?: T; issue?: string } {
  const block = extractJsonBlock(text);
  if (!block) return { issue: "tidak ada blok JSON pada respons" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch (e) {
    return { issue: `JSON tidak valid: ${e instanceof Error ? e.message : "parse error"}` };
  }
  const res = schema.safeParse(parsed);
  if (!res.success) {
    const detail = res.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { issue: `tidak sesuai skema: ${detail}` };
  }
  return { data: res.data };
}

export async function aiStructured<T>(
  schema: z.ZodType<T>,
  req: AiRequest & {
    schemaHint: string;
    /**
     * Tenggat TOTAL satu jawaban (ms) – mencakup retry, perbaikan skema, dan
     * provider cadangan (DECISIONS 635). Tanpa ini hanya ada batas per panggilan.
     */
    tenggatTotalMs?: number;
  },
): Promise<AiStructuredResult<T>> {
  const { tenggatTotalMs, schemaHint, ...dasar } = req;
  const tenggatAt = req.tenggatAt ?? (tenggatTotalMs != null ? Date.now() + tenggatTotalMs : undefined);
  const system = `${req.system ?? ""}\n\n${JSON_RULES}\n\nSkema JSON yang WAJIB diikuti:\n${schemaHint}`.trim();
  const first = await aiCall({ ...dasar, system, tenggatAt });
  if (!first.ok) {
    return { ok: false, errorCode: first.errorCode, error: first.error, meta: first, attempts: 1 };
  }
  const p1 = tryParse(schema, first.text);
  if (p1.data !== undefined) return { ok: true, data: p1.data, meta: first, attempts: 1 };

  /*
   * Satu percobaan perbaikan (DECISIONS 635). Membawa jawaban yang salah
   * (supaya model tahu apa yang dibetulkan) DAN lampiran aslinya (dulu hilang,
   * jadi model "memperbaiki" tanpa melihat surat yang dibacanya). Jawaban yang
   * TERPOTONG batas token tidak diulang apa adanya – yang diminta versi lebih
   * pendek, karena permintaan yang sama akan terpotong di tempat yang sama.
   */
  const potong = terpotong(first.finishReason);
  const instruksi = potong
    ? "Respons sebelumnya TERPOTONG karena melewati batas panjang. Kirim ulang objek JSON yang LEBIH PENDEK: " +
      "ringkas tiap bagian, paling banyak 5 bagian, tetap sesuai skema."
    : `Respons sebelumnya GAGAL divalidasi (${p1.issue}). Kirim ulang HANYA objek JSON yang valid dan sesuai skema.`;
  const second = await aiCall({
    system,
    prompt:
      `${req.prompt}\n\n---\n${instruksi}\n\nRespons sebelumnya (potongan):\n` + first.text.slice(0, 2_000),
    maxTokens: req.maxTokens,
    timeoutMs: req.timeoutMs,
    attachments: req.attachments,
    tenggatAt,
  });
  if (!second.ok) {
    return { ok: false, errorCode: second.errorCode, error: second.error, meta: second, attempts: 2 };
  }
  const p2 = tryParse(schema, second.text);
  if (p2.data !== undefined) {
    // Gabungkan usage dua percobaan supaya biaya tercatat utuh.
    const meta = {
      ...second,
      usage: {
        inputTokens:
          second.usage.inputTokens != null || first.usage.inputTokens != null
            ? (second.usage.inputTokens ?? 0) + (first.usage.inputTokens ?? 0)
            : null,
        outputTokens:
          second.usage.outputTokens != null || first.usage.outputTokens != null
            ? (second.usage.outputTokens ?? 0) + (first.usage.outputTokens ?? 0)
            : null,
      },
      latencyMs: first.latencyMs + second.latencyMs,
    };
    return { ok: true, data: p2.data, meta, attempts: 2 };
  }
  const tetapTerpotong = terpotong(second.finishReason);
  return {
    ok: false,
    errorCode: tetapTerpotong ? "truncated" : "invalid_response",
    error: tetapTerpotong
      ? "Jawaban AI terpotong batas panjang, juga sesudah diminta lebih pendek."
      : `Output AI tidak valid setelah perbaikan: ${p2.issue}`,
    meta: second,
    attempts: 2,
  };
}
