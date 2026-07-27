"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { audit } from "@/lib/audit";
import { accessibleLocationIds, ForbiddenError, requireCapability } from "@/lib/auth/session";
import { canTransitionAiArtifact } from "@/lib/lifecycle";
import { sendText, WahaError } from "@/lib/waha/client";
import { jakartaToday, parseDateKey } from "@/lib/format";
import type { AiArtifactStatus, AiRunKind } from "@/generated/prisma/enums";
import { AiGuardError, getAiGuardConfig } from "./guard";
import { AiRunError, executeAiRun } from "./runs";
import { isAiReportTemplateKey, aiReportTemplate } from "./report-templates";
import { parseAiReportContent, renderAiReportWhatsApp } from "./render";
import type { AskOutput, ReportOutput } from "./schemas";

/**
 * Server Actions AI Hub — SEMUA mutasi: requireCapability + zod + audit.
 * Alur sinkron (satu panggilan provider per operasi); status run/artefak
 * selalu konsisten meski provider gagal. DECISIONS 133.
 */

export type AiHubState = { error?: string; ok?: string } | undefined;

function fail(err: unknown): { error: string } {
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof AiGuardError) return { error: err.message };
  if (err instanceof AiRunError) return { error: err.message };
  if (err instanceof WahaError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

/* ── Periode (selaras preset laporan eksekutif) ─────────────────────────── */

function shiftKey(key: string, deltaDays: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export type AiPeriodPreset = "7hari" | "14hari" | "30hari" | "custom";

function resolvePeriod(preset: string, customStart: string, customEnd: string): { startKey: string; endKey: string } {
  const today = jakartaToday().toISOString().slice(0, 10);
  if (preset === "custom") {
    const s = parseDateKey(customStart);
    const e = parseDateKey(customEnd);
    if (!s || !e) throw new AiRunError("Rentang tanggal khusus tidak valid.");
    let a = customStart;
    let b = customEnd;
    if (a > b) [a, b] = [b, a];
    return { startKey: a, endKey: b };
  }
  const days = preset === "30hari" ? 29 : preset === "14hari" ? 13 : 6;
  return { startKey: shiftKey(today, -days), endKey: today };
}

function readScope(formData: FormData): { locationIds: string[]; startKey: string; endKey: string } {
  const locationIds = formData
    .getAll("locationId")
    .map(String)
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  const { startKey, endKey } = resolvePeriod(
    String(formData.get("period") ?? "7hari"),
    String(formData.get("startDate") ?? ""),
    String(formData.get("endDate") ?? ""),
  );
  return { locationIds, startKey, endKey };
}

/* ── Jalankan analisis (pulse/deviasi/risiko/kualitas_data) ─────────────── */

const ANALYSIS_KINDS: AiRunKind[] = ["pulse", "deviasi", "risiko", "kualitas_data"];

export async function runAnalysisAction(_prev: AiHubState, formData: FormData): Promise<AiHubState> {
  let runId: string;
  try {
    const user = await requireCapability("ai.generate");
    const kind = String(formData.get("kind") ?? "pulse") as AiRunKind;
    if (!ANALYSIS_KINDS.includes(kind)) return { error: "Jenis analisis tidak dikenal." };
    const { locationIds, startKey, endKey } = readScope(formData);
    const result = await executeAiRun(user, { kind, locationIds, startKey, endKey });
    runId = result.runId;
  } catch (err) {
    return fail(err);
  }
  redirect(`/ai/run/${runId}`);
}

/* ── Report Studio: generate draf laporan + artefak ─────────────────────── */

export async function generateAiReportAction(_prev: AiHubState, formData: FormData): Promise<AiHubState> {
  let runId: string;
  try {
    const user = await requireCapability("ai.generate");
    const templateKey = String(formData.get("templateKey") ?? "");
    if (!isAiReportTemplateKey(templateKey)) return { error: "Template laporan tidak dikenal." };
    const template = aiReportTemplate(templateKey)!;
    const { locationIds, startKey, endKey } = readScope(formData);
    const result = await executeAiRun(user, { kind: "laporan", locationIds, startKey, endKey, templateKey });
    runId = result.runId;
    if (result.status === "siap") {
      const run = await db.aiRun.findUnique({ where: { id: runId }, select: { outputJson: true, scopeIds: true } });
      const out = run?.outputJson as { laporan?: ReportOutput; official?: unknown } | null;
      if (out?.laporan) {
        // Versi = jumlah artefak template+scope yang sama + 1 (regenerate → versi baru).
        const scopeHash = createHash("sha256")
          .update(`${templateKey}|${JSON.stringify(run?.scopeIds ?? [])}`)
          .digest("hex")
          .slice(0, 16);
        const version =
          (await db.aiArtifact.count({
            where: { kind: "laporan", templateKey, structuredContent: { path: ["scopeHash"], equals: scopeHash } },
          })) + 1;
        const artifact = await db.aiArtifact.create({
          data: {
            runId,
            kind: "laporan",
            templateKey,
            templateVersion: template.version,
            version,
            status: "draft",
            title: out.laporan.title,
            structuredContent: JSON.parse(
              JSON.stringify({
                scopeHash,
                templateKey,
                templateVersion: template.version,
                report: out.laporan,
                official: out.official,
              }),
            ),
            createdById: user.id,
          },
          select: { id: true },
        });
        await audit(user.id, "ai.artifact.buat", "ai_artifact", artifact.id, { templateKey, version, runId });
      }
    }
  } catch (err) {
    return fail(err);
  }
  redirect(`/ai/run/${runId}`);
}

/* ── Perlu Tindakan: simpan saran sebagai draft artefak (non-eksekusi) ──── */

const suggestionSchema = z.object({
  title: z.string().min(5).max(200),
  detail: z.string().min(5).max(1000),
  category: z.string().max(40),
  severity: z.enum(["sedang", "tinggi", "kritis"]),
  locationId: z.string().uuid().nullable(),
  locationName: z.string().max(120).nullable(),
  suggestKind: z.enum(["action", "recovery"]),
  runId: z.string().uuid().nullable(),
});

export async function saveSuggestionAction(_prev: AiHubState, formData: FormData): Promise<AiHubState> {
  try {
    const user = await requireCapability("ai.generate");
    const parsed = suggestionSchema.safeParse({
      title: String(formData.get("title") ?? ""),
      detail: String(formData.get("detail") ?? ""),
      category: String(formData.get("category") ?? "lainnya"),
      severity: String(formData.get("severity") ?? "sedang"),
      locationId: (formData.get("locationId") as string) || null,
      locationName: (formData.get("locationName") as string) || null,
      suggestKind: String(formData.get("suggestKind") ?? "action"),
      runId: (formData.get("runId") as string) || null,
    });
    if (!parsed.success) return { error: "Data saran tidak valid." };
    const s = parsed.data;
    const artifact = await db.aiArtifact.create({
      data: {
        runId: s.runId,
        kind: "saran",
        status: "draft",
        title: s.title,
        structuredContent: JSON.parse(JSON.stringify(s)),
        createdById: user.id,
      },
      select: { id: true },
    });
    await audit(user.id, "ai.saran.simpan", "ai_artifact", artifact.id, {
      suggestKind: s.suggestKind,
      locationId: s.locationId,
    });
    revalidatePath("/ai/actions");
    return {
      ok: `Draft ${s.suggestKind === "recovery" ? "recovery" : "action"} tersimpan — TIDAK mengubah data domain; eksekusi tetap manual di modul Kendala.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/* ── Lifecycle artefak laporan ──────────────────────────────────────────── */

const TRANSITION_CAPABILITY: Record<AiArtifactStatus, "ai.report_review" | "ai.report_approve"> = {
  draft: "ai.report_review", // kembalikan ke draft (minta perbaikan)
  direview: "ai.report_review", // kirim untuk review
  disetujui: "ai.report_approve",
  beku: "ai.report_approve",
  terkirim: "ai.report_approve", // tidak dipakai langsung (lihat distribute)
};

export async function transitionArtifactAction(_prev: AiHubState, formData: FormData): Promise<AiHubState> {
  try {
    const artifactId = String(formData.get("artifactId") ?? "");
    const to = String(formData.get("to") ?? "") as AiArtifactStatus;
    if (!artifactId || !(to in TRANSITION_CAPABILITY)) return { error: "Transisi tidak valid." };
    const user = await requireCapability(TRANSITION_CAPABILITY[to]);
    const artifact = await db.aiArtifact.findUnique({
      where: { id: artifactId },
      select: { id: true, status: true, kind: true, structuredContent: true, frozenAt: true, runId: true, run: { select: { scopeIds: true } } },
    });
    if (!artifact || artifact.kind !== "laporan") return { error: "Artefak tidak ditemukan." };
    // Lifecycle mengikuti scope baca — RM/PM scoped tidak boleh menyentuh
    // artefak lokasi lain (audit 2026-07-27, B9).
    if (!scopeCoveredBy(await accessibleLocationIds(user), artifact.run?.scopeIds ?? null)) {
      return { error: "Artefak tidak ditemukan." };
    }
    if (!canTransitionAiArtifact(artifact.status, to)) {
      return { error: `Transisi ${artifact.status} → ${to} tidak diizinkan.` };
    }
    if (artifact.frozenAt && to !== "terkirim") return { error: "Artefak beku bersifat immutable." };

    const now = new Date();
    const data: Record<string, unknown> = { status: to };
    if (to === "direview") {
      data.reviewedById = user.id;
      data.reviewedAt = now;
    }
    if (to === "disetujui") {
      data.approvedById = user.id;
      data.approvedAt = now;
    }
    if (to === "beku") {
      const content = parseAiReportContent(artifact.structuredContent);
      data.frozenAt = now;
      data.renderedText = renderAiReportWhatsApp(content);
      data.contentHash = createHash("sha256").update(JSON.stringify(artifact.structuredContent)).digest("hex");
    }
    await db.aiArtifact.update({ where: { id: artifact.id }, data: data as never });
    await audit(user.id, `ai.artifact.${to}`, "ai_artifact", artifact.id, { from: artifact.status });
    if (artifact.runId) revalidatePath(`/ai/run/${artifact.runId}`);
    revalidatePath("/ai/reports");
    return { ok: `Status artefak → ${to}.` };
  } catch (err) {
    return fail(err);
  }
}

const editSchema = z.object({
  artifactId: z.string().uuid(),
  executiveSummary: z.string().min(20).max(4000),
  waSummary: z.string().min(10).max(1800),
  note: z.string().max(300).optional(),
});

export async function editArtifactAction(_prev: AiHubState, formData: FormData): Promise<AiHubState> {
  try {
    const user = await requireCapability("ai.report_review");
    const parsed = editSchema.safeParse({
      artifactId: String(formData.get("artifactId") ?? ""),
      executiveSummary: String(formData.get("executiveSummary") ?? ""),
      waSummary: String(formData.get("waSummary") ?? ""),
      note: String(formData.get("note") ?? "") || undefined,
    });
    if (!parsed.success) return { error: "Isian edit tidak valid (ringkasan terlalu pendek/panjang)." };
    const artifact = await db.aiArtifact.findUnique({
      where: { id: parsed.data.artifactId },
      select: { id: true, status: true, kind: true, structuredContent: true, frozenAt: true, runId: true, run: { select: { scopeIds: true } } },
    });
    if (!artifact || artifact.kind !== "laporan") return { error: "Artefak tidak ditemukan." };
    if (!scopeCoveredBy(await accessibleLocationIds(user), artifact.run?.scopeIds ?? null)) {
      return { error: "Artefak tidak ditemukan." };
    }
    if (artifact.frozenAt || (artifact.status !== "draft" && artifact.status !== "direview" && artifact.status !== "disetujui")) {
      return { error: "Artefak tidak dapat diedit pada status ini." };
    }
    const content = parseAiReportContent(artifact.structuredContent);
    content.report.executiveSummary = parsed.data.executiveSummary;
    content.report.waSummary = parsed.data.waSummary;
    await db.aiArtifact.update({
      where: { id: artifact.id },
      data: {
        structuredContent: JSON.parse(JSON.stringify(content)),
        humanEditNote: parsed.data.note ?? "diedit manual",
      },
    });
    await audit(user.id, "ai.artifact.edit", "ai_artifact", artifact.id, { note: parsed.data.note });
    if (artifact.runId) revalidatePath(`/ai/run/${artifact.runId}`);
    return { ok: "Perubahan tersimpan." };
  } catch (err) {
    return fail(err);
  }
}

export async function distributeArtifactAction(_prev: AiHubState, formData: FormData): Promise<AiHubState> {
  try {
    const user = await requireCapability("ai.report_send");
    const artifactId = String(formData.get("artifactId") ?? "");
    const contactId = String(formData.get("contactId") ?? "");
    const artifact = await db.aiArtifact.findUnique({
      where: { id: artifactId },
      select: { id: true, status: true, kind: true, renderedText: true, structuredContent: true, distributions: true, contentHash: true, runId: true, run: { select: { scopeIds: true } } },
    });
    if (!artifact || artifact.kind !== "laporan") return { error: "Artefak tidak ditemukan." };
    if (!scopeCoveredBy(await accessibleLocationIds(user), artifact.run?.scopeIds ?? null)) {
      return { error: "Artefak tidak ditemukan." };
    }
    if (artifact.status !== "beku" && artifact.status !== "terkirim") {
      return { error: "Hanya artefak BEKU yang boleh didistribusikan — bekukan dulu setelah approve." };
    }
    const contact = await db.waContact.findFirst({
      where: { id: contactId, ownerId: user.id },
      select: { name: true, chatId: true },
    });
    if (!contact) return { error: "Kontak tujuan tidak ditemukan (kelola di Laporan → WA)." };

    const text = artifact.renderedText ?? renderAiReportWhatsApp(parseAiReportContent(artifact.structuredContent));
    await sendText(contact.chatId, text);

    const dist = Array.isArray(artifact.distributions) ? (artifact.distributions as unknown[]) : [];
    dist.push({
      at: new Date().toISOString(),
      channel: "whatsapp",
      target: contact.name,
      chatId: contact.chatId,
      byId: user.id,
      hash: artifact.contentHash,
    });
    await db.aiArtifact.update({
      where: { id: artifact.id },
      data: { status: "terkirim", distributions: JSON.parse(JSON.stringify(dist)) },
    });
    await audit(user.id, "ai.artifact.distribusi", "ai_artifact", artifact.id, { target: contact.name });
    if (artifact.runId) revalidatePath(`/ai/run/${artifact.runId}`);
    return { ok: `Terkirim ke ${contact.name}.` };
  } catch (err) {
    return fail(err);
  }
}

/* ── Ask MARLIN ─────────────────────────────────────────────────────────── */

export async function askMarlinAction(_prev: AiHubState, formData: FormData): Promise<AiHubState> {
  let conversationId: string;
  try {
    const user = await requireCapability("ai.ask");
    const question = String(formData.get("question") ?? "").trim();
    if (question.length < 3) return { error: "Tulis pertanyaan dulu." };
    if (question.length > 1000) return { error: "Pertanyaan terlalu panjang (maks 1000 karakter)." };
    const existingId = String(formData.get("conversationId") ?? "");
    const guardCfg = await getAiGuardConfig();

    let locationIds: string[];
    let startKey: string;
    let endKey: string;
    if (existingId) {
      const convo = await db.aiConversation.findFirst({
        where: { id: existingId, userId: user.id },
        select: { id: true, scopeIds: true, periodStart: true, periodEnd: true, _count: { select: { messages: true } } },
      });
      if (!convo) return { error: "Percakapan tidak ditemukan." };
      if (convo._count.messages >= guardCfg.maxAskPerConversation * 2) {
        return { error: "Percakapan sudah mencapai batas — mulai percakapan baru." };
      }
      conversationId = convo.id;
      locationIds = (convo.scopeIds as string[]) ?? [];
      startKey = convo.periodStart.toISOString().slice(0, 10);
      endKey = convo.periodEnd.toISOString().slice(0, 10);
    } else {
      const scope = readScope(formData);
      locationIds = scope.locationIds;
      startKey = scope.startKey;
      endKey = scope.endKey;
    }

    const result = await executeAiRun(user, { kind: "tanya", locationIds, startKey, endKey, question });
    const run = await db.aiRun.findUnique({
      where: { id: result.runId },
      select: { outputJson: true, scopeIds: true, errorMessage: true },
    });

    if (!existingId) {
      const convo = await db.aiConversation.create({
        data: {
          userId: user.id,
          title: question.slice(0, 80),
          scopeIds: run?.scopeIds ?? locationIds,
          periodStart: new Date(`${startKey}T00:00:00.000Z`),
          periodEnd: new Date(`${endKey}T00:00:00.000Z`),
        },
        select: { id: true },
      });
      conversationId = convo.id;
    } else {
      conversationId = existingId;
      await db.aiConversation.update({ where: { id: existingId }, data: { updatedAt: new Date() } });
    }

    const out = run?.outputJson as { tanya?: AskOutput } | null;
    const answer = out?.tanya;
    await db.aiMessage.create({
      data: { conversationId, role: "user", content: question },
    });
    await db.aiMessage.create({
      data: {
        conversationId,
        role: "asisten",
        content:
          result.status === "siap" && answer
            ? answer.answer
            : `Maaf, analisis gagal: ${run?.errorMessage ?? "provider AI tidak tersedia"}.`,
        citations: answer ? JSON.parse(JSON.stringify(answer.citations)) : undefined,
        confidence: answer?.confidence ?? null,
        runId: result.runId,
      },
    });
  } catch (err) {
    return fail(err);
  }
  redirect(`/ai/ask?c=${conversationId}`);
}

/* ── Pengaturan AI Hub (Sistem → AI; system.manage) ─────────────────────── */

const guardUpdateSchema = z.object({
  enabled: z.boolean(),
  maxRunsPerUserPerHour: z.coerce.number().int().min(1).max(500),
  maxRunsPerOrgPerDay: z.coerce.number().int().min(1).max(5000),
  maxLocationsPerRun: z.coerce.number().int().min(1).max(200),
  maxOutputTokens: z.coerce.number().int().min(256).max(16000),
  inUsdPerMTok: z.coerce.number().min(0).max(1000).optional(),
  outUsdPerMTok: z.coerce.number().min(0).max(1000).optional(),
});

export async function updateAiGuardAction(_prev: AiHubState, formData: FormData): Promise<AiHubState> {
  try {
    const user = await requireCapability("system.manage");
    const parsed = guardUpdateSchema.safeParse({
      enabled: formData.get("enabled") === "on",
      maxRunsPerUserPerHour: formData.get("maxRunsPerUserPerHour"),
      maxRunsPerOrgPerDay: formData.get("maxRunsPerOrgPerDay"),
      maxLocationsPerRun: formData.get("maxLocationsPerRun"),
      maxOutputTokens: formData.get("maxOutputTokens"),
      inUsdPerMTok: String(formData.get("inUsdPerMTok") ?? "") || undefined,
      outUsdPerMTok: String(formData.get("outUsdPerMTok") ?? "") || undefined,
    });
    if (!parsed.success) return { error: "Nilai pengaturan tidak valid." };
    const d = parsed.data;
    const { setAiGuardConfig, setAiPricing } = await import("./guard");
    await setAiGuardConfig(
      {
        maxRunsPerUserPerHour: d.maxRunsPerUserPerHour,
        maxRunsPerOrgPerDay: d.maxRunsPerOrgPerDay,
        maxLocationsPerRun: d.maxLocationsPerRun,
        maxOutputTokens: d.maxOutputTokens,
      },
      d.enabled,
    );
    if (d.inUsdPerMTok != null && d.outUsdPerMTok != null) {
      await setAiPricing({ inUsdPerMTok: d.inUsdPerMTok, outUsdPerMTok: d.outUsdPerMTok });
    }
    await audit(user.id, "ai.guard.ubah", "app_setting", null, {
      enabled: d.enabled,
      maxRunsPerUserPerHour: d.maxRunsPerUserPerHour,
      maxRunsPerOrgPerDay: d.maxRunsPerOrgPerDay,
    });
    revalidatePath("/sistem");
    return { ok: "Pengaturan AI tersimpan." };
  } catch (err) {
    return fail(err);
  }
}
