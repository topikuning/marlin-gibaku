"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { sendText, WahaError } from "@/lib/waha/client";
import { formatTanggal } from "@/lib/format";
import {
  generateChatSummary,
  getPackageContext,
  listSummariesForDate,
  packageTitleOf,
} from "./chat-summary";
import { formatGlobalSummaryForWa, formatSummaryForWa } from "./chat-summary-format";

/** Server action ringkasan chat grup (gate exec_report.send — SM ke atas). DECISIONS 135/137. */

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
    const user = await requireCapability("exec_report.send");
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
    const user = await requireCapability("exec_report.send");
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
        select: { summaryText: true, messageCount: true },
      }),
      db.waContact.findFirst({ where: { id: contactId, ownerId: user.id }, select: { name: true, chatId: true } }),
    ]);
    if (!ctx) return { error: "Paket tidak ditemukan." };
    if (!summary) return { error: "Belum ada ringkasan untuk tanggal ini — buat ringkasan dulu." };
    if (!contact) return { error: "Kontak tujuan tidak ditemukan (kelola di Master Data → Kontak WA)." };

    const text = formatSummaryForWa(
      packageTitleOf(ctx),
      formatTanggal(new Date(`${dateKey}T00:00:00.000Z`), "EEEE, d MMMM yyyy"),
      summary.summaryText,
      summary.messageCount,
    );
    await sendText(contact.chatId, text);
    await audit(user.id, "wa.chat_summary.kirim", "package", packageId, {
      dateKey,
      target: contact.name,
    });
    return { success: `Ringkasan terkirim ke ${contact.name}.` };
  } catch (err) {
    return fail(err);
  }
}

/* ── Kirim ringkasan GLOBAL (semua grup pada satu tanggal) ──────────────── */

const sendGlobalSchema = z.object({ dateKey: dateSchema, contactId: z.uuid("Pilih kontak tujuan") });

const OVERVIEW_SYSTEM = `Anda menyusun pengantar singkat (maks 90 kata) untuk laporan harian chat grup lintas paket proyek KNMP kepada pimpinan.
Aturan: Bahasa Indonesia langsung; HANYA dari ringkasan yang diberikan; sebut paket yang paling perlu perhatian; jangan mengarang angka.`;

export async function sendGlobalSummaryAction(
  _prev: ChatSummaryState,
  formData: FormData,
): Promise<ChatSummaryState> {
  try {
    const user = await requireCapability("exec_report.send");
    const parsed = sendGlobalSchema.safeParse({
      dateKey: formData.get("dateKey"),
      contactId: formData.get("contactId"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { dateKey, contactId } = parsed.data;

    const [rows, contact] = await Promise.all([
      listSummariesForDate(user, dateKey),
      db.waContact.findFirst({ where: { id: contactId, ownerId: user.id }, select: { name: true, chatId: true } }),
    ]);
    if (rows.length === 0) return { error: "Belum ada ringkasan tersimpan pada tanggal ini." };
    if (!contact) return { error: "Kontak tujuan tidak ditemukan (kelola di Master Data → Kontak WA)." };

    // Pengantar AI opsional — bila provider gagal, tetap kirim ringkasan per paket.
    let overview: string | null = null;
    if (rows.length > 1) {
      const { aiCall } = await import("@/lib/ai/client");
      const r = await aiCall({
        system: OVERVIEW_SYSTEM,
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
    await audit(user.id, "wa.chat_summary.kirim_global", "app_setting", null, {
      dateKey,
      packages: rows.length,
      target: contact.name,
      withOverview: overview != null,
    });
    return { success: `Ringkasan ${rows.length} grup terkirim ke ${contact.name}.` };
  } catch (err) {
    return fail(err);
  }
}
