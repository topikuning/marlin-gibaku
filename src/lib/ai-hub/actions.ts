"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { audit, auditIn } from "@/lib/audit";
import { accessibleLocationIds, ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { canTransitionAiArtifact } from "@/lib/lifecycle";
import { WahaError } from "@/lib/waha/client";
import { sendWaMessage } from "@/lib/waha/gateway";
import { normalizeWaTarget } from "@/lib/contacts/model";
import { jakartaToday, parseDateKey } from "@/lib/format";
import type { AiArtifactStatus, AiRunKind } from "@/generated/prisma/enums";
import { AiGuardError, getAiGuardConfig } from "./guard";
import { AiRunError, executeAiRun } from "./runs";
import { isAiReportTemplateKey, aiReportTemplate } from "./report-templates";
import { parseAiReportContent, renderAiReportWhatsApp } from "./render";
import { reportOutputSchema, type AskOutput, type ReportOutput } from "./schemas";
import type { SourceRef } from "./types";

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

export type AiPeriodPreset = "hari_ini" | "kemarin" | "7hari" | "14hari" | "30hari" | "custom";

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
  // hari_ini & kemarin: preset bawaan menu Laporan → WA yang dilebur — dipakai
  // update harian ringkas ke pimpinan (DECISIONS 194).
  if (preset === "hari_ini") return { startKey: today, endKey: today };
  if (preset === "kemarin") {
    const k = shiftKey(today, -1);
    return { startKey: k, endKey: k };
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
    const originRunId = z.string().uuid().safeParse(String(formData.get("originRunId") ?? ""));
    const originConversationId = z.string().uuid().safeParse(
      String(formData.get("originConversationId") ?? ""),
    );
    const accessible = await accessibleLocationIds(user);
    let originContext: string | undefined;
    let origin: { runId?: string; conversationId?: string } | undefined;

    if (originRunId.success) {
      const source = await db.aiRun.findFirst({
        where: { id: originRunId.data, orgId: user.orgId },
        select: { id: true, runKind: true, scopeIds: true, outputJson: true },
      });
      if (source && scopeCoveredBy(accessible, source.scopeIds)) {
        const json = (source.outputJson ?? {}) as Record<string, unknown>;
        const insight = json[source.runKind];
        if (insight) {
          originContext = [
            `Analisis asal (${source.runKind}) berikut diminta pengguna untuk diteruskan ke laporan.`,
            "Pertahankan maksud, prioritas, dan temuan kualitatifnya. JANGAN salin angka lama; semua angka wajib diambil ulang dari DATA resmi run baru.",
            JSON.stringify(insight).slice(0, 10_000),
          ].join("\n");
          origin = { runId: source.id };
        }
      }
    } else if (originConversationId.success) {
      const conversation = await db.aiConversation.findFirst({
        where: { id: originConversationId.data, userId: user.id },
        select: {
          id: true,
          scopeIds: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 8,
            select: { role: true, content: true },
          },
        },
      });
      if (conversation && scopeCoveredBy(accessible, conversation.scopeIds)) {
        originContext = [
          "Percakapan berikut diminta pengguna untuk diteruskan menjadi laporan.",
          "Pertahankan pertanyaan, kesimpulan, dan kebutuhan pengguna. JANGAN salin angka lama; gunakan DATA resmi run baru.",
          ...conversation.messages
            .slice()
            .reverse()
            .map((message) => `${message.role === "user" ? "Penanya" : "MARLIN"}: ${message.content}`),
        ]
          .join("\n")
          .slice(0, 10_000);
        origin = { conversationId: conversation.id };
      }
    }

    const result = await executeAiRun(user, {
      kind: "laporan",
      locationIds,
      startKey,
      endKey,
      templateKey,
      originContext,
    });
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
                origin,
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
      ok: `Draft ${s.suggestKind === "recovery" ? "recovery" : "action"} tersimpan – TIDAK mengubah data domain; eksekusi tetap manual di modul Kendala.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * TERAPKAN draft saran menjadi data domain NYATA (Kendala + opsional aksi
 * pemulihan). Sebelum ini "Simpan Draft" hanya menambah artefak `saran` yang
 * tidak pernah ditampilkan di mana pun — angkanya naik di KPI, tapi tidak ada
 * apa-apa yang terjadi di lokasi (laporan user 2026-08-01). Itu jalan buntu
 * yang melanggar doktrin DECISIONS 193.
 *
 * Prinsip DECISIONS 133 tetap dipegang: AI TIDAK PERNAH menulis Issue/Recovery
 * sendiri. Penulisan terjadi HANYA lewat aksi ini — dipicu manusia, digerbang
 * `issue.manage` + akses lokasi, dan diaudit. Draft yang sudah diterapkan
 * ditandai `terkirim` supaya keluar dari antrean "menunggu tindak lanjut".
 */
export async function terapkanSaranAction(_prev: AiHubState, formData: FormData): Promise<AiHubState> {
  try {
    const artifactId = String(formData.get("artifactId") ?? "");
    const artifact = await db.aiArtifact.findUnique({
      where: { id: artifactId },
      select: { id: true, kind: true, status: true, title: true, structuredContent: true },
    });
    if (!artifact || artifact.kind !== "saran") return { error: "Draft saran tidak ditemukan." };
    if (artifact.status !== "draft") return { error: "Draft ini sudah ditindaklanjuti." };

    const isi = (artifact.structuredContent ?? {}) as {
      title?: string;
      detail?: string;
      severity?: string;
      suggestKind?: string;
      locationId?: string | null;
    };
    const locationId = isi.locationId ?? null;
    if (!locationId) {
      return { error: "Draft ini tidak menunjuk lokasi tertentu – catat manual di workspace lokasi." };
    }

    // Menulis data domain = capability domain, BUKAN ai.generate.
    const user = await requireCapability("issue.manage");
    await requireLocationAccess(user, locationId);
    const loc = await db.location.findUnique({ where: { id: locationId }, select: { slug: true } });
    if (!loc) return { error: "Lokasi tidak ditemukan." };

    const severity = (["sedang", "tinggi", "kritis"] as const).includes(
      isi.severity as "sedang" | "tinggi" | "kritis",
    )
      ? (isi.severity as "sedang" | "tinggi" | "kritis")
      : "sedang";
    const picName = String(formData.get("picName") ?? "").trim() || null;
    const dueRaw = String(formData.get("dueDate") ?? "").trim();
    const dueDate = dueRaw && parseDateKey(dueRaw) ? new Date(`${dueRaw}T00:00:00.000Z`) : null;
    const buatRecovery = isi.suggestKind === "recovery";

    const { issueId } = await db.$transaction(async (tx) => {
      const issue = await tx.issue.create({
        data: {
          locationId,
          title: (isi.title ?? artifact.title).slice(0, 200),
          description: isi.detail ?? null,
          severity,
          raisedById: user.id,
          // Kendala usulan Ask MARLIN yang disetujui orang. Ditulis tegas
          // supaya saringan Sumber di papan kendala tidak berbohong.
          source: "ai",
        },
        select: { id: true },
      });
      if (buatRecovery) {
        await tx.recoveryAction.create({
          data: {
            issueId: issue.id,
            description: (isi.detail ?? artifact.title).slice(0, 2000),
            picName,
            dueDate,
            createdById: user.id,
          },
        });
        // Kendala yang langsung punya aksi pemulihan = sedang ditangani.
        await tx.issue.update({ where: { id: issue.id }, data: { status: "ditangani" } });
      }
      // Tautkan balik + keluarkan dari antrean.
      await tx.aiArtifact.update({
        where: { id: artifact.id },
        data: {
          status: "terkirim",
          structuredContent: JSON.parse(JSON.stringify({ ...isi, issueId: issue.id })),
        },
      });
      await auditIn(
        tx,
        user.id,
        "ai.saran.terapkan",
        "issue",
        issue.id,
        { artifactId: artifact.id, locationId, severity, recovery: buatRecovery },
        null,
      );
      return { issueId: issue.id };
    });

    revalidatePath("/ai/actions");
    revalidatePath(`/lokasi/${loc.slug}`);
    revalidatePath(`/lokasi/${loc.slug}/progress`);
    return {
      ok: buatRecovery
        ? `Kendala + aksi pemulihan dibuat di lokasi – buka workspace lokasi untuk memantau (issue ${issueId.slice(0, 8)}).`
        : `Kendala dibuat di lokasi – buka workspace lokasi untuk memantau (issue ${issueId.slice(0, 8)}).`,
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
      // Dibekukan sebagai versi FINAL: label "draf" tidak boleh ikut terbawa
      // ke pesan yang dikirim pimpinan (DECISIONS 196).
      data.renderedText = renderAiReportWhatsApp(content, true);
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
  title: z.string().min(3).max(160),
  sectionCount: z.coerce.number().int().min(1).max(12),
  recommendationCount: z.coerce.number().int().min(0).max(10),
  note: z.string().max(300).optional(),
});

export async function editArtifactAction(_prev: AiHubState, formData: FormData): Promise<AiHubState> {
  try {
    const user = await requireCapability("ai.report_review");
    const parsed = editSchema.safeParse({
      artifactId: String(formData.get("artifactId") ?? ""),
      title: String(formData.get("title") ?? "").trim(),
      sectionCount: String(formData.get("sectionCount") ?? ""),
      recommendationCount: String(formData.get("recommendationCount") ?? ""),
      note: String(formData.get("note") ?? "") || undefined,
    });
    if (!parsed.success) return { error: "Isian laporan tidak valid atau jumlah bagiannya melampaui batas." };
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
    const originalIndex = (key: string, index: number, max: number): number => {
      const candidate = Number(formData.get(`${key}:${index}`));
      return Number.isInteger(candidate) && candidate >= 0 && candidate < max ? candidate : -1;
    };
    const sections = Array.from({ length: parsed.data.sectionCount }, (_, index) => {
      const sourceIndex = originalIndex("sectionOriginalIndex", index, content.report.sections.length);
      return {
        heading: String(formData.get(`sectionHeading:${index}`) ?? "").trim(),
        body: String(formData.get(`sectionBody:${index}`) ?? "").trim(),
        locationId: sourceIndex >= 0 ? content.report.sections[sourceIndex]?.locationId ?? null : null,
        // Begitu teks diubah manusia, sitasi keluaran model tidak lagi dapat
        // menjamin kalimat baru. Kosongkan bukti AI alih-alih memberi kesan
        // bahwa edit manusia sudah diverifikasi otomatis.
        sourceRefIds: [],
      };
    });
    const recommendations = Array.from({ length: parsed.data.recommendationCount }, (_, index) => {
      const sourceIndex = originalIndex("recommendationOriginalIndex", index, content.report.recommendations.length);
      return {
        title: String(formData.get(`recommendationTitle:${index}`) ?? "").trim(),
        reason: String(formData.get(`recommendationReason:${index}`) ?? "").trim(),
        locationId: sourceIndex >= 0 ? content.report.recommendations[sourceIndex]?.locationId ?? null : null,
        sourceRefIds: [],
      };
    });
    const nextReport = reportOutputSchema.safeParse({
      ...content.report,
      title: parsed.data.title,
      executiveSummary: String(formData.get("executiveSummary") ?? "").trim(),
      executiveSummarySourceRefIds: [],
      confidence: 0,
      waSummary: String(formData.get("waSummary") ?? "").trim(),
      waSummarySourceRefIds: [],
      limitations: [
        ...content.report.limitations.filter((item) => !item.startsWith("Narasi telah diedit manusia")),
        "Narasi telah diedit manusia; cakupan bukti AI tidak lagi berlaku untuk teks hasil edit.",
      ].slice(0, 10),
      sections,
      recommendations,
    });
    if (!nextReport.success) {
      return { error: "Isi laporan belum valid. Pastikan judul, ringkasan, bagian, dan ringkasan WhatsApp tidak kosong atau terlalu panjang." };
    }
    content.report = nextReport.data;
    await db.aiArtifact.update({
      where: { id: artifact.id },
      data: {
        title: nextReport.data.title,
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
      return { error: "Hanya artefak BEKU yang boleh didistribusikan – bekukan dulu setelah approve." };
    }
    // Tujuan: kontak tersimpan ATAU tujuan bebas (nomor / id grup) — fungsi
    // bawaan menu Laporan → WA yang dilebur ke sini (DECISIONS 194). Distribusi
    // tetap hanya untuk artefak BEKU; yang berubah cuma fleksibilitas tujuan.
    let target: { name: string; chatId: string };
    if (contactId) {
      const contact = await db.waContact.findFirst({
        where: { id: contactId, ownerId: user.id },
        select: { name: true, chatId: true },
      });
      if (!contact) return { error: "Kontak tujuan tidak ditemukan (kelola di Master Data → Kontak)." };
      target = contact;
    } else {
      const rawTarget = String(formData.get("destChatId") ?? "").trim();
      if (!rawTarget) return { error: "Pilih kontak tersimpan, atau isi nomor/id grup tujuan." };
      const chatId = normalizeWaTarget(rawTarget); // lempar error berpesan jelas bila format salah
      const destName = String(formData.get("destName") ?? "").trim();
      target = { name: destName || chatId, chatId };
    }

    const text =
      artifact.renderedText ?? renderAiReportWhatsApp(parseAiReportContent(artifact.structuredContent), true);

    /*
     * Lewat gateway kanonik, dan hasilnya DIBACA (DECISIONS 374).
     *
     * Sebelumnya hasil `sendText()` diabaikan sepenuhnya dan UI langsung
     * menulis "Terkirim ke …". Itu keliru dua tingkat: WAHA menjawab 2xx juga
     * saat sesinya belum login, dan bahkan ID pesan pun cuma bukti WAHA
     * MENERIMA — bukan bukti pesannya sampai.
     *
     * Kunci idempotensinya mengikat artefak + tujuan + isi. Menekan tombol
     * kirim dua kali untuk artefak yang sama ke tujuan yang sama tidak akan
     * mengirim dua pesan; mengubah isinya (hash berubah) memang kiriman baru.
     */
    const hasil = await sendWaMessage({
      kind: "teks",
      destination: target.chatId,
      payload: { teks: text },
      idempotencyKey: `artifact:${artifact.id}:${target.chatId}:${artifact.contentHash}`,
      sourceType: "ai_artifact",
      sourceId: artifact.id,
    });
    if (!hasil.diterimaWaha) {
      return { error: hasil.error ?? "Pengiriman WhatsApp gagal." };
    }

    const dist = Array.isArray(artifact.distributions) ? (artifact.distributions as unknown[]) : [];
    dist.push({
      at: new Date().toISOString(),
      channel: "whatsapp",
      target: target.name,
      chatId: target.chatId,
      byId: user.id,
      hash: artifact.contentHash,
      // Jejak ke outbox: status sebenarnya (sampai/dibaca/gagal) hidup di sana
      // dan diperbarui oleh `message.ack`, bukan dibekukan di sini.
      outboundId: hasil.outboundId,
      waMessageId: hasil.waMessageId,
    });
    await db.aiArtifact.update({
      where: { id: artifact.id },
      data: { status: "terkirim", distributions: JSON.parse(JSON.stringify(dist)) },
    });
    await audit(user.id, "ai.artifact.distribusi", "ai_artifact", artifact.id, {
      target: target.name,
      chatId: target.chatId,
      outboundId: hasil.outboundId,
      status: hasil.status,
    });
    if (artifact.runId) revalidatePath(`/ai/run/${artifact.runId}`);
    /*
     * Kalimatnya JUJUR terhadap yang benar-benar diketahui saat ini. "Terkirim"
     * baru sah setelah tanda terima WhatsApp tiba — dan itu terjadi beberapa
     * detik kemudian, di luar permintaan ini.
     */
    return {
      ok: `Sudah diserahkan ke WhatsApp untuk ${target.name}. Status sampai/dibaca menyusul di Sistem → WhatsApp.`,
    };
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
    let conversationHistory: { role: "user" | "assistant"; content: string }[] = [];
    if (existingId) {
      const convo = await db.aiConversation.findFirst({
        where: { id: existingId, userId: user.id },
        select: {
          id: true,
          scopeIds: true,
          periodStart: true,
          periodEnd: true,
          _count: { select: { messages: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 8,
            select: { role: true, content: true },
          },
        },
      });
      if (!convo) return { error: "Percakapan tidak ditemukan." };
      if (convo._count.messages >= guardCfg.maxAskPerConversation * 2) {
        return { error: "Percakapan sudah mencapai batas – mulai percakapan baru." };
      }
      conversationId = convo.id;
      locationIds = (convo.scopeIds as string[]) ?? [];
      startKey = convo.periodStart.toISOString().slice(0, 10);
      endKey = convo.periodEnd.toISOString().slice(0, 10);
      conversationHistory = convo.messages
        .slice()
        .reverse()
        .map((message) => ({
          role: message.role === "user" ? "user" : "assistant",
          content: message.content,
        }));
    } else {
      const scope = readScope(formData);
      locationIds = scope.locationIds;
      startKey = scope.startKey;
      endKey = scope.endKey;
    }

    const result = await executeAiRun(user, {
      kind: "tanya",
      locationIds,
      startKey,
      endKey,
      question,
      conversationHistory,
    });
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

    const out = run?.outputJson as
      | { tanya?: AskOutput; official?: { sourceRefs?: SourceRef[] } }
      | null;
    const answer = out?.tanya;

    /*
     * Sitasi disimpan LENGKAP dengan label & tautannya (DECISIONS 378).
     *
     * Sebelumnya yang tersimpan hanya `sourceRefId`, dan layar percakapan
     * menampilkannya apa adanya: *"sumber: kedung-mutih:progress"*. Itu tidak
     * memberi tahu pembaca angka apa yang dirujuk, dan tidak bisa diklik untuk
     * memeriksanya — jadi "berbasis sumber" hanya benar di dalam kode.
     *
     * Diperkaya SAAT MENULIS, bukan saat render: pesan percakapan hidup lebih
     * lama daripada run-nya, dan sumber yang diresolusi belakangan akan
     * berubah/hilang begitu datanya bergerak. Yang tersimpan di sini adalah apa
     * yang benar SAAT jawaban itu diberikan.
     */
    const refs = new Map((out?.official?.sourceRefs ?? []).map((r) => [r.id, r]));
    const citationNotes = new Map((answer?.citations ?? []).map((citation) => [citation.sourceRefId, citation.note]));
    const citedIds = new Set((answer?.citations ?? []).map((citation) => citation.sourceRefId));
    for (const part of answer?.answerParts ?? []) {
      for (const sourceRefId of part.sourceRefIds ?? []) citedIds.add(sourceRefId);
      for (const claim of part.claims) citedIds.add(claim.sourceRefId);
      for (const quote of part.kutipan ?? []) citedIds.add(quote.chunkId);
    }
    const sitasi = [...citedIds].map((sourceRefId) => {
      const r = refs.get(sourceRefId);
      return {
        sourceRefId,
        note: citationNotes.get(sourceRefId) ?? null,
        label: r?.label ?? null,
        value: r?.value ?? null,
        href: r?.href ?? null,
      };
    });
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
        citations: answer ? JSON.parse(JSON.stringify(sitasi)) : undefined,
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
  // Batas atas 1000, bukan 200: 200 adalah target arsitektur HARI INI, dan
  // form admin tidak boleh jadi tembok berikutnya saat programnya bertambah.
  maxLocationsPerRun: z.coerce.number().int().min(1).max(1000),
  maxInputChars: z.coerce.number().int().min(10_000).max(2_000_000),
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
      maxInputChars: formData.get("maxInputChars"),
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
        // Sebelumnya tidak ada di form sama sekali: batas ukuran payload
        // menolak laporan portofolio penuh dan tak seorang pun bisa
        // menaikkannya tanpa deploy.
        maxInputChars: d.maxInputChars,
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
