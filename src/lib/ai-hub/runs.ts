import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { aiStructured } from "@/lib/ai/structured";
import { conversationContextBlock, type AiConversationTurn } from "@/lib/ai/conversation";
import type { AiRunKind } from "@/generated/prisma/enums";
import { ambilKronologi, type KronologiLokasi } from "@/lib/kronologi/queries";
import { buildKronologiPayload, sumberKronologi } from "./kronologi-format";
import { checkAiGuard, estimateCostUsd, getAiPricing } from "./guard";
import { buildPortfolioPulse, buildQualityDetails, resolveAiScope } from "./source";
import { LABEL_WILAYAH, buildAdapterFacts, gabungFakta } from "./adapters";
import { LABEL_JENIS, cariNarasiAman, type PotonganNarasi } from "@/lib/narasi/cari";
import { runQualityRules } from "./quality-rules";
import {
  buildNarrativeBundle,
  buildNarrativePayload,
  narrativeEntryCount,
  toNarrativeSourceRefs,
  type NarrativeBundle,
} from "./narrative";
import {
  KIND_INSTRUCTION,
  PROMPT_VERSION,
  buildFaktaPayload,
  buildNarasiPayload,
  buildPulsePayload,
  buildQualityPayload,
} from "./prompt";
import { resolvePrompt } from "@/lib/ai/prompts";
import {
  SCHEMA_HINTS,
  kronologiOutputSchema,
  askOutputSchema,
  filterGrounded,
  faktaResmi,
  hitungKeyakinan,
  numericClaimsValid,
  pulseOutputSchema,
  qualityOutputSchema,
  reportOutputSchema,
  riskOutputSchema,
  validasiKlaimTerikat,
  varianceOutputSchema,
  type BagianJawaban,
  type GroundingContext,
} from "./schemas";
import { aiReportTemplate } from "./report-templates";
import { MAKS_ANALISIS, MAKS_KEPUTUSAN } from "./render";
import type { PortfolioPulse, QualityFinding, SourceRef } from "./types";

/**
 * Orkestrasi run AI — SATU panggilan provider per operasi deterministik,
 * sinkron (tanpa worker/queue). Alur: auth (di action) → guard → sumber
 * deterministik → readiness → persist run → panggil provider → validasi
 * skema + grounding → persist output/usage → audit. Status DB selalu benar
 * meski provider gagal. DECISIONS 133.
 */

export class AiRunError extends Error {}

export type ExecuteRunInput = {
  kind: AiRunKind;
  locationIds: string[];
  startKey: string;
  endKey: string;
  /** kind=laporan */
  templateKey?: string;
  /** kind=tanya */
  question?: string;
  /** Riwayat yang sudah dipotong ke percakapan milik user dan scope yang sama. */
  conversationHistory?: AiConversationTurn[];
  /** Temuan run/percakapan asal yang memang diminta dibawa ke artefak baru. */
  originContext?: string;
};

function hashInput(userId: string, i: ExecuteRunInput): string {
  return createHash("sha256")
    .update([
      userId,
      i.kind,
      [...i.locationIds].sort().join(","),
      i.startKey,
      i.endKey,
      i.templateKey ?? "",
      i.question ?? "",
      JSON.stringify(i.conversationHistory ?? []),
      i.originContext ?? "",
    ].join("|"))
    .digest("hex");
}

function groundingContext(pulse: PortfolioPulse, extraRefs: SourceRef[]): GroundingContext {
  const officials = new Map<string, number[]>();
  for (const r of pulse.rows) {
    // HANYA angka bersatuan PERSEN. `extractNumericClaims` cuma menangkap klaim
    // ber-"%"/"pp", jadi kolam pembandingnya wajib sesatuan. Dulu hitungan
    // (jumlah foto, jumlah laporan, minggu, hari, skor risiko) ikut dicampur —
    // klaim "rencana 130,0%" lolos hanya karena ada lokasi ber-photoCount 130.
    // DECISIONS 196.
    officials.set(r.locationId, [r.planPct, r.actualPct, r.deviationPp, r.readiness.score]);
  }
  return {
    allowedLocationIds: new Set(pulse.rows.map((r) => r.locationId)),
    allowedSourceRefIds: new Set([...pulse.sourceRefs, ...extraRefs].map((s) => s.id)),
    officialNumbersByLocation: officials,
  };
}

/** Kind yang boleh memakai narasi lapangan sebagai konteks tambahan (DECISIONS 136). */
const NARRATIVE_KINDS = new Set<AiRunKind>(["pulse", "deviasi", "risiko", "laporan", "tanya"]);

/** Angka global (utk validasi klaim pada teks tanpa lokasi). */
function globalNumbers(pulse: PortfolioPulse): number[] {
  // Lihat catatan di officialNumbersByLocation: kolam WAJIB sesatuan (persen).
  const nums: number[] = [];
  for (const r of pulse.rows) nums.push(r.planPct, r.actualPct, r.deviationPp, r.readiness.score);
  return nums;
}

export type ExecuteRunResult = { runId: string; status: "siap" | "gagal"; error?: string };

export async function executeAiRun(user: SessionUser, input: ExecuteRunInput): Promise<ExecuteRunResult> {
  // 1-2. Scope resmi (intersect izin) — SEBELUM guard supaya locationCount benar.
  const scope = await resolveAiScope(user, input.locationIds);
  if (scope.ids.length === 0) throw new AiRunError("Tidak ada lokasi dalam scope.");

  // 3. Guard: kill switch + rate + ukuran (lempar bila ditolak; sudah diaudit).
  const guardCfg = await checkAiGuard(user, { kind: input.kind, locationCount: scope.ids.length });

  // 4. Anti double-submit: run sama (hash) dalam 90 detik → kembalikan yang ada.
  const inputHash = hashInput(user.id, input);
  const recent = await db.aiRun.findFirst({
    where: {
      userId: user.id,
      inputHash,
      createdAt: { gte: new Date(Date.now() - 90_000) },
      status: { in: ["berjalan", "siap"] },
    },
    select: { id: true, status: true },
  });
  if (recent) return { runId: recent.id, status: recent.status === "siap" ? "siap" : "gagal" };

  // 5. Sumber deterministik + readiness (+ temuan kualitas / narasi lapangan
  //    utk kind terkait). Narasi = catatan laporan harian & kegiatan lapangan
  //    sebagai KONTEKS kualitatif — foto TIDAK dikirim sebagai gambar ke
  //    provider (hanya jumlah + tautan), sesuai batas arsitektur DECISIONS 133.
  const pulse = await buildPortfolioPulse(user, scope.ids, input.startKey, input.endKey);
  let qualityFindings: QualityFinding[] = [];
  if (input.kind === "kualitas_data") {
    const details = await buildQualityDetails(user, scope.ids, input.startKey, input.endKey);
    for (const row of pulse.rows) {
      const d = details.get(row.locationId);
      if (d) qualityFindings.push(...runQualityRules(row, d));
    }
  }
  /*
   * KRONOLOGI menuntut TEPAT SATU lokasi.
   *
   * Bukan pembatasan teknis: kronologi lintas lokasi bukan cerita, ia tumpukan
   * — dan model yang diberi tumpukan akan menyatukan kejadian dua tempat jadi
   * satu alur yang terdengar masuk akal. Ditolak DI SINI, sebelum satu token
   * pun dibayar.
   */
  let kronologi: KronologiLokasi | null = null;
  if (input.kind === "kronologi") {
    if (scope.ids.length !== 1) {
      throw new AiRunError("Kronologi disusun untuk SATU lokasi – pilih satu lokasi lebih dulu.");
    }
    kronologi = await ambilKronologi(scope.ids[0]!, { sampai: input.endKey, hari: 90, batas: 60 });
    if (!kronologi) throw new AiRunError("Lokasi tidak ditemukan.");
  }
  const kronologiRefs = kronologi ? sumberKronologi(kronologi) : [];

  let narrativeBundle: NarrativeBundle | null = null;
  if (NARRATIVE_KINDS.has(input.kind)) {
    narrativeBundle = await buildNarrativeBundle(
      user,
      pulse.rows.map((r) => ({ id: r.locationId, name: r.name, slug: r.slug })),
      input.startKey,
      input.endKey,
    );
  }
  const narrativeRefs = narrativeBundle ? toNarrativeSourceRefs(narrativeBundle) : [];

  /*
   * ADAPTER SUMBER (DECISIONS 379) — kontrak, keuangan, RAB, milestone KKP.
   *
   * Dipagari KAPABILITAS penanya, bukan hanya scope lokasi: `site_manager`
   * punya `ai.ask` tapi TIDAK punya `finance.view`, dan `wakil_ppk` sengaja
   * dijauhkan dari uang internal pelaksana. Lihat `adapters.ts`.
   *
   * Dipanggil DI SINI, sebelum `allSourceRefs` dirakit, supaya sumber tambahan
   * ikut tersimpan di `sourcesJson` dan snapshot resmi — kalau tidak, sitasi ke
   * kontrak/keuangan tidak punya label maupun tautan saat dirender.
   */
  const tambahan =
    input.kind === "tanya"
      ? await buildAdapterFacts(user, scope.ids, pulse.periodEnd)
      : { refs: [], fakta: [], dilewati: [] };

  /*
   * PENCARIAN NARASI LAPANGAN (DECISIONS 382) — hanya untuk `tanya`.
   *
   * Lingkupnya `scope.ids`, disaring DI DALAM query (lihat `cariNarasi`), jadi
   * catatan lokasi di luar hak penanya tidak pernah ikut diperingkat, apalagi
   * dikutip.
   */
  const potongan: PotonganNarasi[] =
    input.kind === "tanya" && input.question
      ? await cariNarasiAman({ locationIds: scope.ids, pertanyaan: input.question })
      : [];

  /*
   * Tiap potongan menjadi sumber yang bisa DIBUKA pembaca. Tanpa ini kutipan
   * hanya berupa teks tanpa jalan memeriksanya — persis cacat sitasi id mentah
   * yang diperbaiki DECISIONS 378.
   */
  const narasiRefs: SourceRef[] = potongan.map((p) => ({
    id: p.id,
    entityType: `narasi_${p.jenis}`,
    entityId: p.locationId,
    label: `${p.namaLokasi} – ${LABEL_JENIS[p.jenis]}${p.tanggal ? ` ${p.tanggal}` : ""}`,
    value: p.teks.length > 160 ? `${p.teks.slice(0, 160)}…` : p.teks,
    href: p.href,
  }));

  const allSourceRefs = [
    ...pulse.sourceRefs,
    ...narrativeRefs,
    ...tambahan.refs,
    ...narasiRefs,
    ...kronologiRefs,
  ];
  const readinessAvg = pulse.rows.length
    ? Math.round(pulse.rows.reduce((s, r) => s + r.readiness.score, 0) / pulse.rows.length)
    : 0;

  // 6. Persist run (berjalan) + snapshot sumber.
  const run = await db.aiRun.create({
    data: {
      userId: user.id,
      // Kuota harian organisasi dihitung dari kolom ini (DECISIONS 351).
      orgId: user.orgId,
      runKind: input.kind,
      status: "berjalan",
      scopeType: scope.all ? "all" : "location",
      scopeIds: scope.ids,
      periodStart: new Date(`${input.startKey}T00:00:00.000Z`),
      periodEnd: new Date(`${input.endKey}T00:00:00.000Z`),
      promptVersion: PROMPT_VERSION,
      inputHash,
      sourceSnapshotAt: pulse.dataAsOf ? new Date(pulse.dataAsOf) : null,
      readinessScore: readinessAvg,
      sourcesJson: JSON.parse(JSON.stringify(allSourceRefs)),
      outputJson: undefined,
    },
    select: { id: true },
  });
  await audit(user.id, "ai.run.buat", "ai_run", run.id, {
    kind: input.kind,
    locations: scope.ids.length,
    period: `${input.startKey}..${input.endKey}`,
    narrativeEntries: narrativeBundle ? narrativeEntryCount(narrativeBundle) : 0,
  });

  // Snapshot deterministik SELALU tersimpan (dipakai UI walau AI gagal).
  const officialSnapshot = JSON.parse(
    JSON.stringify({
      totals: pulse.totals,
      rows: pulse.rows,
      risks: pulse.risks,
      /*
       * Sumber IKUT disimpan (DECISIONS 378).
       *
       * Tanpa ini sitasi hanya bisa ditampilkan sebagai id mentah
       * ("kedung-mutih:progress") — yang tidak memberi tahu pembaca angka apa
       * yang dirujuk, dan tidak bisa diklik untuk memeriksanya. Snapshot ini
       * juga yang dipakai UI saat AI gagal, jadi sumbernya harus ada di sini,
       * bukan dihitung ulang saat render.
       */
      sourceRefs: allSourceRefs,
      quality: qualityFindings,
      narrative: narrativeBundle,
      // Kronologi deterministiknya IKUT tersimpan: layarnya harus tetap
      // memperlihatkan garis waktu walau narasinya gagal dibentuk.
      kronologi,
      periodStart: pulse.periodStart,
      periodEnd: pulse.periodEnd,
      dataAsOf: pulse.dataAsOf,
    }),
  );

  const fail = async (errorCode: string, error: string): Promise<ExecuteRunResult> => {
    await db.aiRun.update({
      where: { id: run.id },
      data: {
        status: "gagal",
        errorCode,
        errorMessage: error.slice(0, 500),
        finishedAt: new Date(),
        outputJson: { official: officialSnapshot },
      },
    });
    await audit(user.id, "ai.run.gagal", "ai_run", run.id, { errorCode });
    return { runId: run.id, status: "gagal", error };
  };

  // 7. Susun prompt per kind.
  let payload = buildPulsePayload(pulse, { maxRows: guardCfg.maxLocationsPerRun });
  if (input.kind === "tanya") {
    // Bentuk klaim yang dituntut validator disodorkan apa adanya — lihat
    // `buildFaktaPayload` untuk alasannya (DECISIONS 378).
    payload += `\n\n${buildFaktaPayload(pulse, {
      maxRows: guardCfg.maxLocationsPerRun,
      tambahan: tambahan.fakta,
      refTambahan: tambahan.refs,
      dilewati: tambahan.dilewati.map((w) => LABEL_WILAYAH[w]),
    })}`;
    payload += `\n\n${buildNarasiPayload(potongan)}`;
  }
  if (kronologi) payload = buildKronologiPayload(kronologi);
  const template = input.kind === "laporan" ? aiReportTemplate(input.templateKey ?? "") : undefined;
  if (input.kind === "laporan" && !template) return fail("invalid_input", "Template laporan tidak dikenal.");

  let instruction: string;
  let schemaHint: string;
  if (input.kind === "laporan") {
    instruction = `Susun laporan terstruktur "${template!.label}". ${template!.instruction}`;
    schemaHint = SCHEMA_HINTS.report;
  } else if (input.kind === "tanya") {
    instruction = KIND_INSTRUCTION.tanya;
    schemaHint = SCHEMA_HINTS.ask;
  } else {
    // Instruksi & aturan dasar dibaca dari pengaturan (Sistem → Prompt AI);
    // bila belum pernah ditimpa, teks bawaan registri yang dipakai.
    instruction =
      (await resolvePrompt(`hub.kind.${input.kind}`)) || KIND_INSTRUCTION[input.kind] || KIND_INSTRUCTION.pulse;
    schemaHint =
      input.kind === "deviasi"
        ? SCHEMA_HINTS.variance
        : input.kind === "risiko"
          ? SCHEMA_HINTS.risk
          : input.kind === "kualitas_data"
            ? SCHEMA_HINTS.quality
            : input.kind === "kronologi"
              ? SCHEMA_HINTS.kronologi
              : SCHEMA_HINTS.pulse;
  }
  const qualityBlock = qualityFindings.length ? `\n\n${buildQualityPayload(qualityFindings)}` : "";
  const narrativeBlock = narrativeBundle ? `\n\n${buildNarrativePayload(narrativeBundle)}` : "";
  const historyBlock = conversationContextBlock(input.conversationHistory ?? []);
  const conversationBlock = historyBlock ? `\n\n${historyBlock}` : "";
  const originBlock = input.originContext?.trim()
    ? `\n\nKONTEKS ASAL YANG WAJIB DIPERTAHANKAN:\n${input.originContext.trim()}`
    : "";
  const questionBlock = input.question ? `\n\nPERTANYAAN USER:\n${input.question}` : "";
  const prompt = `${instruction}\n\n=== DATA ===\n${payload}${qualityBlock}${narrativeBlock}${conversationBlock}${originBlock}${questionBlock}`;
  if (prompt.length > guardCfg.maxInputChars) {
    return fail("input_too_big", "Data sumber melebihi batas – persempit scope/periode.");
  }

  // 8. SATU panggilan provider terstruktur (+maks 1 repair internal).
  const schema =
    input.kind === "laporan"
      ? reportOutputSchema
      : input.kind === "tanya"
        ? askOutputSchema
        : input.kind === "deviasi"
          ? varianceOutputSchema
          : input.kind === "risiko"
            ? riskOutputSchema
            : input.kind === "kualitas_data"
              ? qualityOutputSchema
              : input.kind === "kronologi"
                ? kronologiOutputSchema
                : pulseOutputSchema;
  const result = await aiStructured(schema as never, {
    system: await resolvePrompt("hub.system"),
    prompt,
    schemaHint,
    maxTokens: guardCfg.maxOutputTokens,
    timeoutMs: guardCfg.timeoutMs,
  });

  if (!result.ok) return fail(result.errorCode, result.error);

  // 9. Grounding: buang bagian tak tergrounding, catat sebagai limitations.
  const ctx = groundingContext(pulse, [...narrativeRefs, ...tambahan.refs, ...narasiRefs]);
  // Teks asli tiap potongan — dasar pemeriksaan kutipan VERBATIM (DECISIONS 382).
  const teksPotongan = new Map(potongan.map((p) => [p.id, p.teks]));
  const globals = globalNumbers(pulse);
  // Fakta terikat (lokasi, metrik) → nilai + periode + sumber (DECISIONS 378),
  // ditambah fakta adapter yang boleh dilihat penanya (DECISIONS 379).
  const fakta = gabungFakta(faktaResmi(pulse), tambahan.fakta);
  const output = result.data as Record<string, unknown>;
  const evidenceCount = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  const evidenceCandidates =
    input.kind === "pulse"
      ? evidenceCount(output.priorityLocations) + evidenceCount(output.actionsToConsider)
      : input.kind === "deviasi"
        ? evidenceCount(output.locations)
        : input.kind === "risiko"
          ? evidenceCount(output.rationales)
          : input.kind === "kualitas_data"
            ? evidenceCount(output.explanations)
            : input.kind === "kronologi"
              ? evidenceCount(output.babak)
              : input.kind === "laporan"
                ? evidenceCount(output.sections) + evidenceCount(output.recommendations) + 2
                : 0;
  const droppedNotes: string[] = [];
  const applyFilter = <T extends object>(arr: T[] | undefined): T[] => {
    if (!Array.isArray(arr)) return [];
    const { kept, report } = filterGrounded(arr as never[], ctx);
    droppedNotes.push(...report.dropped);
    return kept as T[];
  };
  if (input.kind === "pulse") {
    output.priorityLocations = applyFilter(output.priorityLocations as never[]);
    output.actionsToConsider = applyFilter(output.actionsToConsider as never[]);
  } else if (input.kind === "deviasi") {
    output.locations = applyFilter(output.locations as never[]);
  } else if (input.kind === "risiko") {
    output.rationales = applyFilter(output.rationales as never[]);
  } else if (input.kind === "kualitas_data") {
    output.explanations = applyFilter(output.explanations as never[]);
  } else if (input.kind === "kronologi") {
    output.babak = applyFilter(output.babak as never[]);
  } else if (input.kind === "laporan") {
    if (Array.isArray(output.sections)) {
      const before = output.sections.length;
      output.sections = (output.sections as { sourceRefIds?: string[] }[]).filter(
        (section) => Array.isArray(section.sourceRefIds) && section.sourceRefIds.length > 0,
      );
      if (before > (output.sections as unknown[]).length) {
        droppedNotes.push(`${before - (output.sections as unknown[]).length} bagian laporan dibuang: tidak memiliki sumber`);
      }
    }
    output.sections = applyFilter(output.sections as never[]);
    // Isi bagian (body) ikut divalidasi — dulu hanya reason/explanation
    // (audit B10): angka karangan bisa bersembunyi di paragraf isi.
    if (Array.isArray(output.sections)) {
      const before = output.sections.length;
      output.sections = (output.sections as { body?: string }[]).filter(
        (sec) => typeof sec.body !== "string" || numericClaimsValid(sec.body, globals),
      );
      const removed = before - (output.sections as unknown[]).length;
      if (removed > 0) droppedNotes.push(`${removed} bagian laporan dibuang: isi memuat angka tanpa sumber`);
    }
    if ((output.sections as unknown[]).length === 0) {
      output.sections = [
        {
          heading: "Bagian analisis perlu ditulis ulang",
          body: "Tidak ada bagian keluaran AI yang lolos pemeriksaan sumber. Gunakan editor laporan untuk menulis kesimpulan hasil review manusia.",
          locationId: null,
          sourceRefIds: [],
        },
      ];
    }
    if (Array.isArray(output.recommendations)) {
      const before = output.recommendations.length;
      output.recommendations = (output.recommendations as { sourceRefIds?: string[] }[]).filter(
        (recommendation) => Array.isArray(recommendation.sourceRefIds) && recommendation.sourceRefIds.length > 0,
      );
      if (before > (output.recommendations as unknown[]).length) {
        droppedNotes.push(`${before - (output.recommendations as unknown[]).length} rekomendasi dibuang: tidak memiliki sumber`);
      }
    }
    output.recommendations = applyFilter(output.recommendations as never[]);
    const groundedSections = (output.sections as { body?: string; sourceRefIds?: string[] }[]).filter(
      (section) => (section.sourceRefIds?.length ?? 0) > 0 && typeof section.body === "string" && section.body.trim().length > 0,
    );
    const refRingkasanValid = (value: unknown): value is string[] =>
      Array.isArray(value) && value.length > 0 && value.every((ref) => typeof ref === "string" && ctx.allowedSourceRefIds.has(ref));
    const fallbackRefs = [...new Set(groundedSections.flatMap((section) => section.sourceRefIds ?? []))].slice(0, 12);
    const fallbackSummary = groundedSections.length
      ? groundedSections
          .slice(0, 3)
          .map((section) => section.body!.trim().replace(/\s+/g, " ").slice(0, 320))
          .join(" ")
          .slice(0, 960)
      : "Tidak ada narasi AI yang lolos pemeriksaan sumber. Reviewer perlu menulis ringkasan berdasarkan data resmi yang tersedia.";

    // Ringkasan kini membawa sumbernya sendiri. Keluaran model dipertahankan
    // hanya bila semua rujukan sah; artefak lama/tanpa sumber memakai fallback
    // singkat dari maksimal tiga bagian yang sudah lolos grounding.
    output.title = template?.label ?? "Laporan Pengendalian";
    if (!refRingkasanValid(output.executiveSummarySourceRefIds)) {
      output.executiveSummary = fallbackSummary;
      output.executiveSummarySourceRefIds = fallbackRefs;
      droppedNotes.push("ringkasan eksekutif model diganti: tidak memiliki sumber yang sah");
    }
    if (!refRingkasanValid(output.waSummarySourceRefIds)) {
      output.waSummary = fallbackSummary.slice(0, 1_800);
      output.waSummarySourceRefIds = fallbackRefs;
      droppedNotes.push("ringkasan WhatsApp model diganti: tidak memiliki sumber yang sah");
    }
    // executiveSummary & title DULU tidak diperiksa sama sekali (cek generik di
    // bawah menyasar `output.summary` yang tidak ada di skema laporan, jadi
    // lewat diam-diam) — padahal keduanya tampil di panel, PDF, dan Excel.
    if (typeof output.executiveSummary === "string" && !numericClaimsValid(output.executiveSummary, globals)) {
      output.executiveSummary =
        "[Ringkasan eksekutif dibuang: memuat angka yang tidak cocok data resmi – tulis ulang manual.]";
      droppedNotes.push("ringkasan eksekutif dibuang: memuat angka tanpa sumber");
    }
    if (typeof output.title === "string" && !numericClaimsValid(output.title, globals)) {
      droppedNotes.push("judul memuat angka yang tidak cocok data resmi – periksa manual");
    }
    if (typeof output.waSummary === "string" && !numericClaimsValid(output.waSummary, globals)) {
      // PROJECT.md §5a: bagian yang gagal grounding DIBUANG — ringkasan WA yang
      // angkanya tak bersumber tidak boleh ikut terkirim (audit B10; dulu cuma
      // jadi limitation dan TETAP dikirim).
      output.waSummary = "";
      droppedNotes.push("ringkasan WA dibuang: memuat angka tanpa sumber – tulis ulang manual sebelum kirim");
    }
  } else if (input.kind === "tanya") {
    const cites = (output.citations as { sourceRefId: string }[] | undefined) ?? [];
    output.citations = cites.filter((c) => ctx.allowedSourceRefIds.has(c.sourceRefId));

    /*
     * VALIDASI KLAIM TERIKAT (DECISIONS 378).
     *
     * Bagian yang klaimnya tidak cocok DIBUANG, bukan sekadar ditandai —
     * PROJECT.md §5a. Sebelum ini jawaban dengan angka salah tetap tampil utuh
     * dan hanya menambah satu baris limitation di bawahnya, yang di WhatsApp
     * maupun PDF nyaris tidak pernah terbaca.
     */
    const parts = (output.answerParts as BagianJawaban[] | undefined) ?? [];
    const hasil = validasiKlaimTerikat(parts, fakta, ctx.allowedSourceRefIds, teksPotongan);
    output.answerParts = hasil.hidup;
    droppedNotes.push(...hasil.dibuang);

    if (parts.length > 0) {
      /*
       * Teks jawaban DISUSUN ULANG dari bagian yang selamat.
       *
       * Kalau `answer` dibiarkan apa adanya, membuang bagian tidak ada
       * gunanya: kalimat yang sama tetap terbaca penanya lewat `answer`.
       */
      const teks = hasil.hidup.map((b) => b.text.trim()).filter(Boolean).join(" ");
      output.answer = teks || "Saya tidak punya angka bersumber untuk menjawab itu.";
    } else if (typeof output.answer === "string" && !numericClaimsValid(output.answer, globals)) {
      // Keluaran model lama (tanpa answerParts) tetap dijaga cara lama.
      droppedNotes.push("jawaban memuat angka persen yang tidak cocok data – verifikasi manual");
    }

    /*
     * Wilayah yang ditahan kapabilitas ikut ke limitations (DECISIONS 379) —
     * bukan hanya diberitahukan ke model.
     *
     * Model bisa lupa menyebutkannya, dan kalau itu terjadi penanya membaca
     * jawaban yang diam-diam sebagian tanpa tanda apa pun. Baris ini tampil di
     * layar terlepas dari apa yang model tulis.
     */
    if (tambahan.dilewati.length > 0) {
      droppedNotes.push(
        `Tidak ditampilkan untuk peran Anda: ${tambahan.dilewati
          .map((w) => LABEL_WILAYAH[w])
          .join(", ")} – angkanya ada, tetapi di luar hak akses Anda.`,
      );
    }

    // Keyakinan DETERMINISTIK — menimpa angka yang diakui sendiri oleh model.
    output.confidence = hitungKeyakinan(hasil, parts.length);
    if (output.confidence === 0) {
      droppedNotes.push(
        "keyakinan 0: tidak ada klaim angka yang cocok dengan data resmi beserta sumbernya",
      );
    }
  }
  if (input.kind !== "tanya") {
    const evidenceKept =
      input.kind === "pulse"
        ? evidenceCount(output.priorityLocations) + evidenceCount(output.actionsToConsider)
        : input.kind === "deviasi"
          ? evidenceCount(output.locations)
          : input.kind === "risiko"
            ? evidenceCount(output.rationales)
            : input.kind === "kualitas_data"
              ? evidenceCount(output.explanations)
              : input.kind === "kronologi"
                ? evidenceCount(output.babak)
                : input.kind === "laporan"
                ? evidenceCount(output.sections) + evidenceCount(output.recommendations) -
                  ((output.sections as { sourceRefIds?: string[] }[] | undefined)?.filter((section) => section.sourceRefIds?.length === 0).length ?? 0) +
                  (evidenceCount(output.executiveSummarySourceRefIds) > 0 ? 1 : 0) +
                  (evidenceCount(output.waSummarySourceRefIds) > 0 ? 1 : 0)
                : 0;
    // Angka dari model tidak pernah dipakai sebagai rasa percaya diri. Nilai
    // ini adalah cakupan bagian yang selamat dari validator sumber.
    output.confidence = evidenceCandidates > 0 ? Math.round((Math.max(0, evidenceKept) / evidenceCandidates) * 100) : 0;
  }

  /*
   * BATAS FORMAT EKSEKUTIF (DECISIONS 453/454) — ditegakkan di sini, bukan
   * cuma diminta lewat prompt, karena model tetap sering mengirim lebih.
   *
   * Letaknya SESUDAH `confidence` dihitung dengan sengaja: pemangkasan ini
   * urusan penyajian, bukan kegagalan grounding. Kalau dipangkas lebih dulu,
   * laporan yang justru kaya bukti malah tampil dengan cakupan bukti rendah.
   *
   * Yang dipangkas DISEBUTKAN di limitations — pemangkasan diam-diam persis
   * masalah yang sedang diperbaiki.
   */
  if (input.kind === "laporan") {
    const sections = (output.sections as unknown[] | undefined) ?? [];
    if (sections.length > MAKS_ANALISIS) {
      output.sections = sections.slice(0, MAKS_ANALISIS);
      droppedNotes.push(
        `${sections.length - MAKS_ANALISIS} bagian analisis dipangkas: format eksekutif memuat maksimal ${MAKS_ANALISIS} bagian pendukung`,
      );
    }
    const recommendations = (output.recommendations as unknown[] | undefined) ?? [];
    if (recommendations.length > MAKS_KEPUTUSAN) {
      output.recommendations = recommendations.slice(0, MAKS_KEPUTUSAN);
      droppedNotes.push(
        `${recommendations.length - MAKS_KEPUTUSAN} usulan dipangkas: pimpinan diminta memutuskan maksimal ${MAKS_KEPUTUSAN} hal per laporan`,
      );
    }
  }
  // Ringkasan global: klaim angka dibandingkan seluruh angka resmi.
  if (typeof output.summary === "string" && !numericClaimsValid(output.summary, globals)) {
    droppedNotes.push("ringkasan memuat angka yang tidak cocok data resmi – verifikasi manual");
  }
  const limitations = [
    ...((output.limitations as string[] | undefined) ?? []),
    ...(pulse.limitations ?? []),
    ...droppedNotes,
  ].slice(0, 15);
  output.limitations = limitations;

  // 10. Persist hasil + usage + estimasi biaya.
  const pricing = await getAiPricing();
  const cost = estimateCostUsd(pricing, result.meta.usage);
  const confidence = typeof output.confidence === "number" ? output.confidence : null;
  await db.aiRun.update({
    where: { id: run.id },
    data: {
      status: "siap",
      provider: result.meta.provider,
      model: result.meta.model,
      confidence,
      outputJson: JSON.parse(JSON.stringify({ [input.kind]: output, official: officialSnapshot })),
      limitations,
      inputTokens: result.meta.usage.inputTokens,
      outputTokens: result.meta.usage.outputTokens,
      latencyMs: result.meta.latencyMs,
      estimatedCostUsd: cost != null ? cost.toFixed(6) : undefined,
      finishedAt: new Date(),
    },
  });
  await audit(user.id, "ai.run.siap", "ai_run", run.id, {
    kind: input.kind,
    provider: result.meta.provider,
    model: result.meta.model,
    inputTokens: result.meta.usage.inputTokens,
    outputTokens: result.meta.usage.outputTokens,
    latencyMs: result.meta.latencyMs,
    attempts: result.attempts,
  });
  return { runId: run.id, status: "siap" };
}
