import "server-only";
import { aiCall } from "@/lib/ai/client";
import { getActiveAiConfig } from "@/lib/ai/config";
import { checkAiGuard, AiGuardError } from "@/lib/ai-hub/guard";
import type { SessionUser } from "@/lib/auth/session";
import {
  buildRewritePrompt,
  cleanRewrite,
  REWRITE_SYSTEM_PROMPT,
  rewriteInputProblem,
  verifyRewrite,
  type RewriteContext,
} from "@/lib/field-activity/rewrite";

/**
 * Panggilan model untuk merapikan teks kegiatan lapangan. Hasilnya USULAN —
 * tidak pernah tersimpan sendiri; pemanggil (server action) mengembalikannya ke
 * layar untuk disetujui manusia.
 *
 * Guard AI Hub (kill-switch + kuota per user/org) dipakai ulang supaya fitur
 * ini tidak jadi pintu belakang yang melewati batas pemakaian AI.
 */

export type RewriteResult =
  | { ok: true; text: string; model: string }
  | { ok: false; error: string };

export async function rewriteFieldText(
  user: SessionUser,
  ctx: RewriteContext,
): Promise<RewriteResult> {
  const inputProblem = rewriteInputProblem(ctx.text);
  if (inputProblem) return { ok: false, error: inputProblem };

  if (!(await getActiveAiConfig())) {
    return { ok: false, error: "AI belum dikonfigurasi — atur penyedia & API key di halaman Sistem." };
  }

  try {
    await checkAiGuard(user, {
      kind: "kegiatan.rapikan_teks",
      locationCount: 1,
      inputChars: ctx.text.length,
    });
  } catch (e) {
    if (e instanceof AiGuardError) return { ok: false, error: e.message };
    throw e;
  }

  const res = await aiCall({
    system: REWRITE_SYSTEM_PROMPT,
    prompt: buildRewritePrompt(ctx),
    // Perapian tidak boleh melar; batas token sengaja ketat.
    maxTokens: 900,
    timeoutMs: 45_000,
  });
  if (!res.ok) return { ok: false, error: res.error };

  const text = cleanRewrite(res.text);
  const verdict = verifyRewrite(ctx.text, text);
  if (!verdict.ok) {
    // Usulan dibuang, BUKAN ditampilkan dengan catatan kecil: teks laporan
    // ikut ke dokumen resmi, jadi yang meragukan tidak boleh sampai ke layar.
    return {
      ok: false,
      error: `Usulan AI ditolak penjaga: ${verdict.problems.join(" ")} Teks asli dibiarkan apa adanya.`,
    };
  }
  if (text === ctx.text.trim()) {
    return { ok: false, error: "Teks sudah rapi — tidak ada yang perlu diubah." };
  }

  return { ok: true, text, model: res.model };
}
