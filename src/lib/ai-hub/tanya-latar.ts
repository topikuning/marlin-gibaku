import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { jalankanDiLatar } from "@/lib/auth/latar";
import { pesanGagalUntukPenanya } from "./pesan-gagal";
import { executeAiRun } from "./runs";
import type { AskOutput } from "./schemas";
import type { SourceRef } from "./types";

/**
 * Menjawab pertanyaan Ask MARLIN DI LATAR (DECISIONS 455).
 *
 * Sebelumnya seluruh panggilan provider ditahan di dalam request server action.
 * Anggarannya sah sampai ±6 menit (4 panggilan × timeout + jeda), sementara
 * peramban menyerah jauh lebih awal: log edge 2026-08-27 mencatat 499 pada
 * detik ke-125 dengan `txBytes: 0`. Jawabannya tetap terhitung dan terbayar,
 * tetapi penanyanya tidak pernah melihatnya.
 *
 * Sekarang request hanya menulis pertanyaan lalu selesai; pekerjaan beratnya
 * jalan terus di proses yang sama dan hasilnya masuk ke percakapan. Layar
 * membaca `AiConversation.pendingSince` untuk tahu ia harus menunggu.
 *
 * MODUL INI TIDAK BOLEH MELEMPAR KE PEMANGGIL: ia sengaja dipanggil tanpa
 * `await`. Setiap jalur keluar wajib menulis sesuatu ke percakapan dan
 * mengosongkan penanda tunggu — percakapan yang menggantung tanpa kabar adalah
 * kegagalan yang lebih buruk daripada pesan galat.
 */

export type TanyaLatarInput = {
  conversationId: string;
  question: string;
  locationIds: string[];
  startKey: string;
  endKey: string;
  conversationHistory: { role: "user" | "assistant"; content: string }[];
};

/**
 * Sitasi disimpan LENGKAP dengan label & tautannya (DECISIONS 378) — diperkaya
 * SAAT MENULIS, bukan saat render: pesan percakapan hidup lebih lama daripada
 * run-nya, dan sumber yang diresolusi belakangan akan berubah/hilang begitu
 * datanya bergerak. Yang tersimpan adalah apa yang benar SAAT jawaban diberikan.
 */
function rakitSitasi(
  answer: AskOutput | undefined,
  sourceRefs: SourceRef[],
): { sourceRefId: string; note: string | null; label: string | null; value: string | null; href: string | null }[] {
  const refs = new Map(sourceRefs.map((r) => [r.id, r]));
  const citationNotes = new Map((answer?.citations ?? []).map((citation) => [citation.sourceRefId, citation.note]));
  const citedIds = new Set((answer?.citations ?? []).map((citation) => citation.sourceRefId));
  for (const part of answer?.answerParts ?? []) {
    for (const sourceRefId of part.sourceRefIds ?? []) citedIds.add(sourceRefId);
    for (const claim of part.claims) citedIds.add(claim.sourceRefId);
    for (const quote of part.kutipan ?? []) citedIds.add(quote.chunkId);
  }
  return [...citedIds].map((sourceRefId) => {
    const r = refs.get(sourceRefId);
    return {
      sourceRefId,
      note: citationNotes.get(sourceRefId) ?? null,
      label: r?.label ?? null,
      value: r?.value ?? null,
      href: r?.href ?? null,
    };
  });
}

async function tulisJawaban(user: SessionUser, input: TanyaLatarInput): Promise<void> {
  const result = await executeAiRun(user, {
    kind: "tanya",
    locationIds: input.locationIds,
    startKey: input.startKey,
    endKey: input.endKey,
    question: input.question,
    conversationHistory: input.conversationHistory,
  });
  const run = await db.aiRun.findUnique({
    where: { id: result.runId },
    select: { outputJson: true, errorMessage: true },
  });
  const out = run?.outputJson as { tanya?: AskOutput; official?: { sourceRefs?: SourceRef[] } } | null;
  const answer = out?.tanya;
  if (result.status !== "siap" || !answer) {
    // Rinciannya tetap ada di `AiRun.errorMessage`; yang masuk percakapan
    // hanya kalimat yang berguna bagi penanya.
    console.error(`[ai/tanya-latar] run ${result.runId} gagal: ${run?.errorMessage ?? "(tanpa pesan)"}`);
  }
  await db.aiMessage.create({
    data: {
      conversationId: input.conversationId,
      role: "asisten",
      content:
        result.status === "siap" && answer
          ? answer.answer
          : pesanGagalUntukPenanya(null),
      citations: answer ? JSON.parse(JSON.stringify(rakitSitasi(answer, out?.official?.sourceRefs ?? []))) : undefined,
      confidence: answer?.confidence ?? null,
      runId: result.runId,
    },
  });
}

/**
 * Jalankan di latar. Sengaja TIDAK mengembalikan Promise yang perlu ditunggu:
 * pemanggil (server action) harus bisa membalas seketika.
 */
export function mulaiJawabanLatar(user: SessionUser, input: TanyaLatarInput): void {
  // Ditandai LATAR (DECISIONS 456): `requestIp()` tidak boleh menyentuh
  // `headers()` di sini, dan tidak perlu lagi menelan galat untuk semua orang.
  void jalankanDiLatar(async () => {
    try {
      await tulisJawaban(user, input);
    } catch (err) {
      // Termasuk penolakan guard dan kegagalan tak terduga. Percakapan HARUS
      // tetap mendapat kabar; kalau tidak, penanya menunggu sesuatu yang tidak
      // akan pernah datang.
      console.error("[ai/tanya-latar] pekerjaan latar gagal:", err);
      await db.aiMessage
        .create({
          data: {
            conversationId: input.conversationId,
            role: "asisten",
            content: pesanGagalUntukPenanya(err),
          },
        })
        .catch(() => {
          /* DB pun tidak bisa ditulis — penanda tunggu di bawah yang menyelamatkan layar. */
        });
    } finally {
      await db.aiConversation
        .update({ where: { id: input.conversationId }, data: { pendingSince: null } })
        .catch(() => {
          /* Bila ini gagal, batasJawabanMs() di layar yang menutup penantiannya. */
        });
    }
  });
}
