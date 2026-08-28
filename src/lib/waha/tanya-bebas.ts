import "server-only";

import type { SessionUser } from "@/lib/auth/session";
import { aiStructured, type AiStructuredResult } from "@/lib/ai/structured";
import { conversationContextBlock, type AiConversationTurn } from "@/lib/ai/conversation";
import { buildPortfolioPulse } from "@/lib/ai-hub/source";
import { buildFaktaPayload, buildNarasiPayload, buildPulsePayload, KIND_INSTRUCTION, SYSTEM_BASE } from "@/lib/ai-hub/prompt";
import {
  askOutputSchema,
  faktaResmi,
  hitungKeyakinan,
  SCHEMA_HINTS,
  validasiKlaimTerikat,
  type AskOutput,
  type BagianJawaban,
} from "@/lib/ai-hub/schemas";
import { LABEL_JENIS, cariNarasiAman } from "@/lib/narasi/cari";
import type { SourceRef } from "@/lib/ai-hub/types";
import {
  buildAdapterFacts,
  gabungFakta,
  LABEL_WILAYAH,
  type HasilAdapter,
  type WilayahAdapter,
} from "@/lib/ai-hub/adapters";

export type HasilJawabanBebas = {
  providerResult: AiStructuredResult<AskOutput>;
  text: string | null;
  output: AskOutput | null;
  sourceRefs: SourceRef[];
};

/**
 * Jawaban WA untuk pertanyaan di luar daftar niat kaku.
 *
 * Model hanya merangkai fakta snapshot dan kutipan yang sudah dipilih MARLIN.
 * Setelah model menjawab, setiap bagian tanpa fakta/kutipan/sourceRef yang sah
 * dibuang. Dengan begitu fleksibel tidak berarti bebas mengarang.
 */
export async function jawabPertanyaanBebasTergrounding(input: {
  user: SessionUser;
  locationIds: string[];
  question: string;
  startKey: string;
  endKey: string;
  history?: AiConversationTurn[];
  /** Hanya chat pribadi; data berkapabilitas tidak boleh bocor ke seluruh grup. */
  adapterUser?: SessionUser;
  /**
   * true = pertanyaan datang dari GRUP, sehingga seluruh wilayah berkapabilitas
   * (kontrak, RAB, temuan, kesiapan, peringatan dini, verifikasi, inspeksi,
   * surat, keuangan) sengaja ditahan.
   *
   * Penahanannya benar dan tidak diubah: satu grup berisi orang dengan hak yang
   * berbeda-beda, dan jawaban di sana dibaca semuanya sekaligus. Yang salah
   * adalah DIAMNYA — penanya cuma menerima "tidak ada datanya", lalu mengira
   * MARLIN tidak punya datanya, padahal ia hanya tidak boleh menyebutnya di
   * ruang itu. Dengan penanda ini, penahanannya ikut dikatakan berikut jalan
   * keluarnya: tanya lagi lewat chat pribadi.
   */
  ditahanKarenaGrup?: boolean;
}): Promise<HasilJawabanBebas> {
  const tanpaAdapter: HasilAdapter = {
    refs: [],
    fakta: [],
    dilewati: input.ditahanKarenaGrup ? (Object.keys(LABEL_WILAYAH) as WilayahAdapter[]) : [],
  };
  const [pulse, potongan, tambahan] = await Promise.all([
    buildPortfolioPulse(input.user, input.locationIds, input.startKey, input.endKey),
    cariNarasiAman({ locationIds: input.locationIds, pertanyaan: input.question, batas: 8 }),
    input.adapterUser
      ? buildAdapterFacts(input.adapterUser, input.locationIds, input.endKey)
      : Promise.resolve(tanpaAdapter),
  ]);
  const narasiRefs: SourceRef[] = potongan.map((p) => ({
    id: p.id,
    entityType: `narasi_${p.jenis}`,
    entityId: p.locationId,
    label: `${p.namaLokasi} – ${LABEL_JENIS[p.jenis]}${p.tanggal ? ` ${p.tanggal}` : ""}`,
    value: p.teks.length > 160 ? `${p.teks.slice(0, 160)}…` : p.teks,
    href: p.href,
  }));
  const sourceRefs = [...pulse.sourceRefs, ...tambahan.refs, ...narasiRefs];
  const historyBlock = conversationContextBlock(input.history ?? [], { maxTurns: 8, maxChars: 5_000 });
  const prompt = [
    KIND_INSTRUCTION.tanya,
    "Jawab seperti rekan pengendalian proyek yang ringkas dan luwes. Jangan memaksa pertanyaan ke menu/perintah tertentu.",
    "Jika data tidak cukup, katakan tepatnya data apa yang belum tersedia dan jangan menebak.",
    "",
    "=== DATA ===",
    buildPulsePayload(pulse),
    "",
    buildFaktaPayload(pulse, {
      tambahan: tambahan.fakta,
      refTambahan: tambahan.refs,
      dilewati: tambahan.dilewati.map((wilayah) => LABEL_WILAYAH[wilayah]),
    }),
    "",
    buildNarasiPayload(potongan),
    ...(historyBlock ? ["", historyBlock] : []),
    "",
    "PERTANYAAN TERBARU:",
    input.question,
  ].join("\n");

  const providerResult = await aiStructured(askOutputSchema, {
    system: SYSTEM_BASE,
    prompt,
    schemaHint: SCHEMA_HINTS.ask,
    maxTokens: 1_200,
    timeoutMs: 25_000,
  });
  if (!providerResult.ok) return { providerResult, text: null, output: null, sourceRefs };

  const allowedRefs = new Set(sourceRefs.map((ref) => ref.id));
  const potonganAsli = new Map(potongan.map((p) => [p.id, p.teks]));
  /*
   * `as` TANPA penjagaan adalah bohong pada pemeriksa tipe: bila keluaran tidak
   * membawa `answerParts`, yang terjadi bukan "jawaban tanpa bagian" melainkan
   * TypeError di dalam validator — dan penanya WhatsApp menerima diam, bukan
   * kalimat "sumber tidak cukup". Skema memang memberi default [], jadi ini
   * pagar untuk keluaran di luar skema (provider lama, stub uji), sama seperti
   * yang sudah dilakukan `executeAiRun`.
   */
  const parts = (providerResult.data.answerParts as BagianJawaban[] | undefined) ?? [];
  const validation = validasiKlaimTerikat(
    parts,
    gabungFakta(faktaResmi(pulse), tambahan.fakta),
    allowedRefs,
    potonganAsli,
  );
  const citations = providerResult.data.citations.filter((citation) => allowedRefs.has(citation.sourceRefId));
  const limitations = [
    ...providerResult.data.limitations,
    ...(pulse.limitations ?? []),
    ...(tambahan.dilewati.length
      ? [
          input.ditahanKarenaGrup
            ? `Tidak saya sebutkan di grup: ${tambahan.dilewati.map((wilayah) => LABEL_WILAYAH[wilayah]).join(", ")}. Tanyakan lewat chat pribadi ke MARLIN – di sana jawabannya mengikuti hak akses Anda sendiri.`
            : `Tidak ditampilkan untuk peran Anda: ${tambahan.dilewati.map((wilayah) => LABEL_WILAYAH[wilayah]).join(", ")}.`,
        ]
      : []),
    ...validation.dibuang,
  ].slice(0, 8);
  const answer = validation.hidup.map((part) => part.text.trim()).filter(Boolean).join("\n\n");
  const output: AskOutput = {
    ...providerResult.data,
    answer: answer || "Saya belum menemukan sumber yang cukup untuk menjawab pertanyaan itu.",
    answerParts: validation.hidup.map((part) => ({
      ...part,
      kutipan: part.kutipan ?? [],
      sourceRefIds: part.sourceRefIds ?? [],
    })),
    citations,
    confidence: hitungKeyakinan(validation, parts.length),
    limitations,
  };
  if (!answer) return { providerResult, text: null, output, sourceRefs };

  const usedIds = new Set<string>();
  for (const part of validation.hidup) {
    for (const id of part.sourceRefIds ?? []) usedIds.add(id);
    for (const claim of part.claims) usedIds.add(claim.sourceRefId);
    for (const quote of part.kutipan ?? []) usedIds.add(quote.chunkId);
  }
  for (const citation of citations) usedIds.add(citation.sourceRefId);
  const used = sourceRefs.filter((ref) => usedIds.has(ref.id)).slice(0, 4);
  const sourceBlock = used.length
    ? `\n\nSumber yang bisa diperiksa:\n${used.map((ref) => `- ${ref.label}`).join("\n")}`
    : "";
  const limitationBlock = limitations.length ? `\n\nCatatan batas data: ${limitations[0]}` : "";
  return { providerResult, text: `${answer}${sourceBlock}${limitationBlock}`, output, sourceRefs };
}
