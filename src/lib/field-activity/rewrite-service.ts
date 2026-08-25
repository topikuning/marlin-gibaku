import "server-only";
import { aiCall } from "@/lib/ai/client";
import { getActiveAiConfig } from "@/lib/ai/config";
import { checkAiGuard, AiGuardError } from "@/lib/ai-hub/guard";
import { resolvePrompts } from "@/lib/ai/prompts";
import type { SessionUser } from "@/lib/auth/session";
import {
  buildBatchRewritePrompt,
  REWRITE_FIELD_LABEL,
  parseBatchRewrite,
  REWRITE_MAX_CHARS,
  REWRITE_MIN_CHARS,
  REWRITE_SYSTEM_PROMPT,
  verifyRewrite,
  type RewriteField,
  type RewriteStyle,
} from "@/lib/field-activity/rewrite";

/**
 * Perapian teks kegiatan saat FINALISASI: satu panggilan model untuk seluruh
 * teks bebas (catatan/kendala/tindak lanjut), lalu tiap bagian diperiksa
 * penjaga masing-masing (DECISIONS 179).
 *
 * Hasilnya USULAN — tidak ada yang tersimpan di sini. Server action yang
 * memanggil mengembalikannya ke layar; penyimpanan baru terjadi saat pengguna
 * mencentang bagian yang dipakai dan menekan finalkan.
 */

export type FieldSuggestion = {
  field: RewriteField;
  original: string;
  /** null = tidak ada usulan yang layak dipakai. */
  suggestion: string | null;
  /** Alasan bila usulan dibuang penjaga (ditampilkan apa adanya ke pengguna). */
  rejected?: string;
  /** Catatan yang menyertai usulan yang LOLOS (mis. hasil lebih panjang). */
  note?: string;
};

export type SuggestResult =
  | { ok: true; style: RewriteStyle; model: string; fields: FieldSuggestion[] }
  | { ok: false; error: string };

export type ActivityTexts = Partial<Record<RewriteField, string | null>>;

/** Bagian yang cukup panjang untuk dirapikan (yang lain dilewati apa adanya). */
function eligibleFields(texts: ActivityTexts): { field: RewriteField; text: string }[] {
  const order: RewriteField[] = ["notes", "kendala", "solusi"];
  return order
    .map((field) => ({ field, text: (texts[field] ?? "").trim() }))
    .filter((f) => f.text.length >= REWRITE_MIN_CHARS && f.text.length <= REWRITE_MAX_CHARS);
}

export async function suggestActivityRewrite(
  user: SessionUser,
  input: {
    texts: ActivityTexts;
    style: RewriteStyle;
    kindLabel?: string | null;
    title?: string | null;
  },
): Promise<SuggestResult> {
  const fields = eligibleFields(input.texts);
  if (fields.length === 0) {
    return { ok: false, error: "Belum ada teks yang cukup panjang untuk dirapikan." };
  }

  if (!(await getActiveAiConfig())) {
    return { ok: false, error: "AI belum dikonfigurasi – atur penyedia & API key di halaman Sistem." };
  }

  const inputChars = fields.reduce((n, f) => n + f.text.length, 0);
  try {
    await checkAiGuard(user, { kind: "kegiatan.rapikan_finalisasi", locationCount: 1, inputChars });
  } catch (e) {
    if (e instanceof AiGuardError) return { ok: false, error: e.message };
    throw e;
  }

  const teks = await resolvePrompts(["kegiatan.rewrite.system", `kegiatan.rewrite.${input.style}`]);
  const res = await aiCall({
    system: teks["kegiatan.rewrite.system"] || REWRITE_SYSTEM_PROMPT,
    prompt: buildBatchRewritePrompt({
      fields,
      style: input.style,
      kindLabel: input.kindLabel ?? null,
      title: input.title ?? null,
      styleInstruction: teks[`kegiatan.rewrite.${input.style}`],
    }),
    maxTokens: 1600,
    timeoutMs: 60_000,
  });
  if (!res.ok) return { ok: false, error: res.error };

  const parsed = parseBatchRewrite(res.text);
  const out: FieldSuggestion[] = fields.map(({ field, text }) => {
    const usul = parsed[field];
    if (!usul) return { field, original: text, suggestion: null, rejected: "model tidak mengembalikan bagian ini" };
    if (usul === text) return { field, original: text, suggestion: null, rejected: "sudah rapi" };
    // Pemeriksa MENANDAI, bukan memblokir — usulan tetap ditawarkan bersama
    // catatannya, pengguna yang memutuskan (DECISIONS 181).
    const verdict = verifyRewrite(text, usul);
    if (!verdict.ok) {
      return { field, original: text, suggestion: null, rejected: verdict.problems.join("; ") };
    }
    return {
      field,
      original: text,
      suggestion: usul,
      note: verdict.warnings.length > 0 ? verdict.warnings.join(" ") : undefined,
    };
  });

  if (out.every((f) => f.suggestion === null)) {
    const rincian = out
      .map((f) => `${REWRITE_FIELD_LABEL[f.field]}: ${f.rejected ?? "tidak ada usulan"}`)
      .join(" · ");
    return {
      ok: false,
      error: `Tidak ada usulan yang bisa dipakai – ${rincian}. Teks asli dibiarkan apa adanya.`,
    };
  }

  return { ok: true, style: input.style, model: res.model, fields: out };
}
