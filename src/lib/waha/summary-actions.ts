"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { promptDefault } from "@/lib/ai/prompt-registry";
import { resolvePrompt } from "@/lib/ai/prompts";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { WahaError } from "@/lib/waha/client";
import { sendText } from "@/lib/waha/kirim";
import { formatTanggal } from "@/lib/format";
import {
  generateChatSummary,
  getPackageContext,
  listSummariesForDate,
  packageTitleOf,
} from "./chat-summary";
import { formatGlobalSummaryForWa, formatSummaryForWa } from "./chat-summary-format";
import {
  canSend,
  parseDispatches,
  transitionSummary,
  type SummaryViewStatus,
} from "./summary-lifecycle";

/** Server action ringkasan chat grup (gate wa.chat — SM ke atas). DECISIONS 135/137. */

export type ChatSummaryState = { error?: string; success?: string } | undefined;

function fail(err: unknown): ChatSummaryState {
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof WahaError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid");

const generateSchema = z.object({ packageId: z.uuid(), dateKey: dateSchema });

export async function generateChatSummaryAction(
  _prev: ChatSummaryState,
  formData: FormData,
): Promise<ChatSummaryState> {
  try {
    const user = await requireCapability("wa.chat");
    const parsed = generateSchema.safeParse({
      packageId: formData.get("packageId"),
      dateKey: formData.get("dateKey"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const r = await generateChatSummary(user, parsed.data.packageId, parsed.data.dateKey);
    if (!r.ok) return { error: r.error };
    revalidatePath("/chat-grup");
    revalidatePath("/chat-grup/global");
    return { success: "Ringkasan tersimpan." };
  } catch (err) {
    return fail(err);
  }
}

/* ── Sunting & finalkan draf ────────────────────────────────────────────── */

const editSchema = z.object({
  packageId: z.uuid(),
  dateKey: dateSchema,
  summaryText: z.string().trim().min(20, "Ringkasan terlalu pendek (min. 20 karakter)").max(20_000),
  /** "simpan" = tetap draf disunting; "final" = sekalian finalkan. */
  mode: z.enum(["simpan", "final"]),
});

/**
 * Simpan editan manusia atas draf AI, opsional sekaligus finalkan. Menyunting
 * ringkasan yang sudah terkirim mengembalikannya ke status draf disunting —
 * yang sudah dikirim ke pimpinan tidak boleh diam-diam berubah jadi "final"
 * tanpa kiriman ulang. DECISIONS 139.
 */
export async function saveSummaryDraftAction(
  _prev: ChatSummaryState,
  formData: FormData,
): Promise<ChatSummaryState> {
  try {
    const user = await requireCapability("wa.chat");
    const parsed = editSchema.safeParse({
      packageId: formData.get("packageId"),
      dateKey: formData.get("dateKey"),
      summaryText: formData.get("summaryText"),
      mode: formData.get("mode"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { packageId, dateKey, summaryText, mode } = parsed.data;
    const summaryDate = new Date(`${dateKey}T00:00:00.000Z`);

    const current = await db.waChatSummary.findUnique({
      where: { packageId_summaryDate: { packageId, summaryDate } },
      select: { id: true, status: true, summaryText: true, package: { select: { orgId: true } } },
    });
    if (!current) return { error: "Belum ada draf untuk tanggal ini — hasilkan draf AI dulu." };
    if (current.package.orgId !== user.orgId) return { error: "Paket tidak ditemukan." };

    const from = current.status as SummaryViewStatus;
    const changed = current.summaryText.trim() !== summaryText;
    // Finalkan tanpa mengubah teks tetap sah — itu tindakan verifikasi manusia.
    const target = mode === "final" ? "final" : changed ? "edited_draft" : from === "draft_ai" ? "draft_ai" : from;
    const gate = transitionSummary(from, target as "draft_ai" | "edited_draft" | "final");
    if (!gate.ok) return { error: gate.error };

    const now = new Date();
    await db.waChatSummary.update({
      where: { id: current.id },
      data: {
        summaryText,
        status: gate.status,
        ...(changed ? { editedById: user.id, editedAt: now } : {}),
        ...(gate.status === "final" ? { finalizedById: user.id, finalizedAt: now } : {}),
      },
    });
    await audit(user.id, mode === "final" ? "wa.chat_summary.finalkan" : "wa.chat_summary.sunting", "package", packageId, {
      dateKey,
      from,
      to: gate.status,
      textChanged: changed,
    });
    revalidatePath("/chat-grup");
    revalidatePath("/chat-grup/global");
    return {
      success: gate.status === "final" ? "Ringkasan difinalkan — siap dikirim." : "Editan tersimpan.",
    };
  } catch (err) {
    return fail(err);
  }
}

/* ── Kirim ringkasan SATU grup ke kontak WA ─────────────────────────────── */

const sendSchema = z.object({
  packageId: z.uuid(),
  dateKey: dateSchema,
  contactId: z.uuid("Pilih kontak tujuan"),
});

export async function sendChatSummaryAction(
  _prev: ChatSummaryState,
  formData: FormData,
): Promise<ChatSummaryState> {
  try {
    const user = await requireCapability("wa.chat");
    const parsed = sendSchema.safeParse({
      packageId: formData.get("packageId"),
      dateKey: formData.get("dateKey"),
      contactId: formData.get("contactId"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { packageId, dateKey, contactId } = parsed.data;

    const [ctx, summary, contact] = await Promise.all([
      getPackageContext(user, packageId),
      db.waChatSummary.findUnique({
        where: { packageId_summaryDate: { packageId, summaryDate: new Date(`${dateKey}T00:00:00.000Z`) } },
        select: { id: true, summaryText: true, messageCount: true, status: true, dispatches: true },
      }),
      db.waContact.findFirst({ where: { id: contactId, ownerId: user.id }, select: { name: true, chatId: true } }),
    ]);
    if (!ctx) return { error: "Paket tidak ditemukan." };
    if (!summary) return { error: "Belum ada ringkasan untuk tanggal ini — buat ringkasan dulu." };
    if (!contact) return { error: "Kontak tujuan tidak ditemukan (kelola di Master Data → Kontak WA)." };
    // Draf AI mentah tidak boleh sampai ke pimpinan tanpa review manusia.
    if (!canSend(summary.status as SummaryViewStatus)) {
      return { error: "Ringkasan belum difinalkan. Review dulu, lalu klik “Finalkan”." };
    }

    const text = formatSummaryForWa(
      packageTitleOf(ctx),
      formatTanggal(new Date(`${dateKey}T00:00:00.000Z`), "EEEE, d MMMM yyyy"),
      summary.summaryText,
      summary.messageCount,
    );
    await sendText(contact.chatId, text);
    const now = new Date();
    await db.waChatSummary.update({
      where: { id: summary.id },
      data: {
        status: "sent",
        lastSentAt: now,
        dispatches: [
          ...parseDispatches(summary.dispatches),
          { at: now.toISOString(), target: contact.name, chatId: contact.chatId, byId: user.id },
        ],
      },
    });
    await audit(user.id, "wa.chat_summary.kirim", "package", packageId, {
      dateKey,
      target: contact.name,
    });
    revalidatePath("/chat-grup");
    revalidatePath("/chat-grup/global");
    return { success: `Ringkasan terkirim ke ${contact.name}.` };
  } catch (err) {
    return fail(err);
  }
}

/* ── Kirim ringkasan GLOBAL (semua grup pada satu tanggal) ──────────────── */

const sendGlobalSchema = z.object({ dateKey: dateSchema, contactId: z.uuid("Pilih kontak tujuan") });

const OVERVIEW_SYSTEM = promptDefault("chat.overview");

export async function sendGlobalSummaryAction(
  _prev: ChatSummaryState,
  formData: FormData,
): Promise<ChatSummaryState> {
  try {
    const user = await requireCapability("wa.chat");
    const parsed = sendGlobalSchema.safeParse({
      dateKey: formData.get("dateKey"),
      contactId: formData.get("contactId"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { dateKey, contactId } = parsed.data;

    const [all, contact] = await Promise.all([
      listSummariesForDate(user, dateKey),
      db.waContact.findFirst({ where: { id: contactId, ownerId: user.id }, select: { name: true, chatId: true } }),
    ]);
    if (all.length === 0) return { error: "Belum ada ringkasan tersimpan pada tanggal ini." };
    // Hanya yang sudah diverifikasi manusia yang ikut ke pimpinan.
    const rows = all.filter((r) => canSend(r.status));
    if (rows.length === 0) {
      return {
        error: `Belum ada ringkasan berstatus final pada tanggal ini (${all.length} masih draf). Finalkan dulu di halaman per-grup.`,
      };
    }
    if (!contact) return { error: "Kontak tujuan tidak ditemukan (kelola di Master Data → Kontak WA)." };

    // Pengantar AI opsional — bila provider gagal, tetap kirim ringkasan per paket.
    let overview: string | null = null;
    if (rows.length > 1) {
      const { aiCall } = await import("@/lib/ai/client");
      const r = await aiCall({
        system: (await resolvePrompt("chat.overview")) || OVERVIEW_SYSTEM,
        prompt:
          `Tanggal: ${dateKey}\n\n` +
          rows.map((x) => `## ${x.title} (${x.messageCount} pesan)\n${x.summaryText}`).join("\n\n"),
        maxTokens: 400,
        timeoutMs: 60_000,
      });
      if (r.ok) overview = r.text;
    }

    const text = formatGlobalSummaryForWa(
      formatTanggal(new Date(`${dateKey}T00:00:00.000Z`), "EEEE, d MMMM yyyy"),
      rows.map((r) => ({ title: r.title, summaryText: r.summaryText, messageCount: r.messageCount })),
      overview,
    );
    await sendText(contact.chatId, text);
    const now = new Date();
    await db.waChatSummary.updateMany({
      where: {
        summaryDate: new Date(`${dateKey}T00:00:00.000Z`),
        packageId: { in: rows.map((r) => r.packageId) },
      },
      data: { status: "sent", lastSentAt: now },
    });
    await audit(user.id, "wa.chat_summary.kirim_global", "app_setting", null, {
      dateKey,
      packages: rows.length,
      skippedDraft: all.length - rows.length,
      target: contact.name,
      withOverview: overview != null,
    });
    revalidatePath("/chat-grup");
    revalidatePath("/chat-grup/global");
    const skipped = all.length - rows.length;
    return {
      success:
        `Ringkasan ${rows.length} grup terkirim ke ${contact.name}.` +
        (skipped > 0 ? ` ${skipped} grup dilewati karena belum final.` : ""),
    };
  } catch (err) {
    return fail(err);
  }
}

/* ── Pemetaan nama pengirim (alias) ─────────────────────────────────────── */

const aliasSchema = z.object({
  senderKey: z.string().min(3, "Kunci pengirim tidak valid").max(160),
  displayName: z.string().trim().min(2, "Nama minimal 2 karakter").max(120),
  role: z.string().trim().max(60).optional(),
});

/**
 * Beri NAMA pada pengirim chat yang hanya dikenal sebagai nomor/LID. Dipakai
 * semua ringkasan berikutnya (dan tampilan arsip). DECISIONS 138.
 */
export async function saveSenderAliasAction(
  _prev: ChatSummaryState,
  formData: FormData,
): Promise<ChatSummaryState> {
  try {
    const user = await requireCapability("wa.chat");
    const parsed = aliasSchema.safeParse({
      senderKey: String(formData.get("senderKey") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      role: String(formData.get("role") ?? "") || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const senderKey = parsed.data.senderKey.toLowerCase();
    await db.waSenderAlias.upsert({
      where: { orgId_senderKey: { orgId: user.orgId, senderKey } },
      update: { displayName: parsed.data.displayName, role: parsed.data.role || null },
      create: {
        orgId: user.orgId,
        senderKey,
        displayName: parsed.data.displayName,
        role: parsed.data.role || null,
        createdById: user.id,
      },
    });
    await audit(user.id, "wa.sender_alias.simpan", "wa_sender_alias", null, {
      senderKey,
      displayName: parsed.data.displayName,
    });
    revalidatePath("/chat-grup");
    return { success: `Pengirim dikenali sebagai "${parsed.data.displayName}".` };
  } catch (err) {
    return fail(err);
  }
}
