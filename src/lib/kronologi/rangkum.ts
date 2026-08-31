import "server-only";
import { aiStructured, type AiStructuredResult } from "@/lib/ai/structured";
import { resolvePrompt } from "@/lib/ai/prompts";
import { SYSTEM_BASE } from "@/lib/ai-hub/prompt";
import {
  buildKronologiPayload,
  rapikanKeluaranKronologi,
  sumberKronologi,
} from "@/lib/ai-hub/kronologi-format";
import { kronologiOutputSchema, SCHEMA_HINTS, type KronologiOutput } from "@/lib/ai-hub/schemas";
import type { SourceRef } from "@/lib/ai-hub/types";
import type { KronologiLokasi } from "./queries";

/**
 * Merapikan kronologi lewat AI untuk jalur WhatsApp — panggilan RAMPING.
 *
 * Sengaja tidak lewat `executeAiRun`: jalur itu merakit Portfolio Pulse untuk
 * seluruh scope, menyimpan snapshot penuh, dan memang begitu seharusnya untuk
 * layar. Untuk satu balasan WhatsApp ongkos itu tidak sebanding — dan polanya
 * sudah ada: `tanya-bebas.ts` melakukan hal yang sama untuk pertanyaan bebas,
 * lalu mencatat pemakaiannya lewat `catatRun`.
 *
 * Yang TIDAK diringankan: bahannya sama persis (`buildKronologiPayload`),
 * skemanya sama, instruksinya dibaca dari registri prompt yang sama, dan
 * pembersih keluarannya sama (`rapikanKeluaranKronologi`). Dua permukaan boleh
 * berbeda ongkos; keduanya tidak boleh berbeda aturan.
 */
export type HasilRangkumKronologi = {
  providerResult: AiStructuredResult<KronologiOutput>;
  output: KronologiOutput | null;
  sourceRefs: SourceRef[];
  dibuang: string[];
};

export async function rangkumKronologi(k: KronologiLokasi): Promise<HasilRangkumKronologi> {
  const sourceRefs = sumberKronologi(k);
  const providerResult = await aiStructured(kronologiOutputSchema, {
    system: SYSTEM_BASE,
    prompt: `${await resolvePrompt("hub.kind.kronologi")}\n\n=== DATA ===\n${buildKronologiPayload(k)}`,
    schemaHint: SCHEMA_HINTS.kronologi,
    maxTokens: 1_200,
    timeoutMs: 25_000,
  });
  if (!providerResult.ok) return { providerResult, output: null, sourceRefs, dibuang: [] };

  const rapi = rapikanKeluaranKronologi(
    providerResult.data,
    new Set(sourceRefs.map((r) => r.id)),
  );
  return { providerResult, output: rapi.output, sourceRefs, dibuang: rapi.dibuang };
}
