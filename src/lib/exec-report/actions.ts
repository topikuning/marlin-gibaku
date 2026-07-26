"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { jakartaToday, parseDateKey, formatTanggal } from "@/lib/format";
import { sendText, WahaError } from "@/lib/waha/client";
import { aiComplete } from "@/lib/ai/client";
import { gatherExecData } from "@/lib/exec-report/gather";
import { buildExecPrompt } from "@/lib/exec-report/prompt";
import { isExecReportKey, isPeriodPreset } from "@/lib/exec-report/catalog";

/** Laporan Eksekutif → WA (rangkuman AI). Semua aksi gate `exec_report.send`. DECISIONS 122. */

function fail(err: unknown): { error: string } {
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof WahaError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

/* ── Periode ─────────────────────────────────────────────────────────────── */

function shiftKey(key: string, deltaDays: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function resolvePeriod(
  preset: string,
  customStart: string,
  customEnd: string,
): { startKey: string; endKey: string; label: string } {
  const today = jakartaToday().toISOString().slice(0, 10);
  let startKey = today;
  let endKey = today;
  if (preset === "kemarin") {
    startKey = endKey = shiftKey(today, -1);
  } else if (preset === "7hari") {
    startKey = shiftKey(today, -6);
    endKey = today;
  } else if (preset === "custom") {
    const s = parseDateKey(customStart);
    const e = parseDateKey(customEnd);
    if (!s || !e) throw new Error("Rentang tanggal khusus tidak valid.");
    startKey = customStart;
    endKey = customEnd;
    if (startKey > endKey) [startKey, endKey] = [endKey, startKey];
  }
  const sDate = parseDateKey(startKey)!;
  const eDate = parseDateKey(endKey)!;
  const label =
    startKey === endKey
      ? formatTanggal(sDate, "EEEE, d MMMM yyyy")
      : `${formatTanggal(sDate)} – ${formatTanggal(eDate)}`;
  return { startKey, endKey, label };
}

/* ── Susun draf (AI) ─────────────────────────────────────────────────────── */

export type ExecReportState =
  | { error?: string; draft?: string; label?: string; reportKey?: string; startKey?: string; endKey?: string }
  | undefined;

export async function generateExecReportAction(
  _prev: ExecReportState,
  formData: FormData,
): Promise<ExecReportState> {
  try {
    const user = await requireCapability("exec_report.send");
    const key = String(formData.get("reportKey") ?? "");
    if (!isExecReportKey(key)) return { error: "Jenis laporan tidak valid." };
    const presetRaw = String(formData.get("period") ?? "hari_ini");
    const preset = isPeriodPreset(presetRaw) ? presetRaw : "hari_ini";
    const { startKey, endKey, label } = resolvePeriod(
      preset,
      String(formData.get("startDate") ?? ""),
      String(formData.get("endDate") ?? ""),
    );

    const data = await gatherExecData(user, startKey, endKey);
    if (data.totalLocations === 0) {
      return { error: "Tidak ada lokasi dalam cakupanmu untuk periode ini." };
    }

    const { system, prompt } = buildExecPrompt(key, data, label);
    const result = await aiComplete({ system, prompt, maxTokens: 1500 });
    if (!result.ok) return { error: `AI gagal menyusun: ${result.error}` };

    return { draft: result.text, label, reportKey: key, startKey, endKey };
  } catch (err) {
    return fail(err);
  }
}

/* ── Kirim ke WA ─────────────────────────────────────────────────────────── */

export type ExecSendState = { error?: string; success?: string } | undefined;

/** Normalisasi tujuan WA: id grup "…@g.us", kontak "…@c.us", atau nomor → "…@c.us". */
function normalizeWaTarget(raw: string): string {
  const t = raw.trim();
  if (!t) throw new Error("Tujuan WA kosong.");
  if (t.endsWith("@g.us") || t.endsWith("@c.us") || t.endsWith("@s.whatsapp.net")) return t;
  const digits = t.replace(/[^0-9]/g, "");
  if (digits.length >= 8) return `${digits}@c.us`;
  throw new Error(`Format tujuan WA tidak dikenal: ${raw} (pakai nomor WA, atau id grup …@g.us).`);
}

export async function sendExecReportAction(
  _prev: ExecSendState,
  formData: FormData,
): Promise<ExecSendState> {
  try {
    const user = await requireCapability("exec_report.send");
    const text = String(formData.get("text") ?? "").trim();
    if (text.length < 5) return { error: "Teks laporan kosong — susun dulu dengan AI." };
    const key = String(formData.get("reportKey") ?? "laporan");
    const startKey = String(formData.get("startKey") ?? "");
    const endKey = String(formData.get("endKey") ?? "");
    const periodStart = parseDateKey(startKey) ?? jakartaToday();
    const periodEnd = parseDateKey(endKey) ?? jakartaToday();

    // Tujuan: kontak tersimpan (milik user) ATAU input bebas.
    const contactId = String(formData.get("contactId") ?? "").trim();
    let destName: string;
    let destChatId: string;
    if (contactId) {
      const contact = await db.waContact.findFirst({
        where: { id: contactId, ownerId: user.id },
        select: { name: true, chatId: true },
      });
      if (!contact) return { error: "Kontak tidak ditemukan." };
      destName = contact.name;
      destChatId = contact.chatId;
    } else {
      destChatId = normalizeWaTarget(String(formData.get("destChatId") ?? ""));
      destName = String(formData.get("destName") ?? "").trim() || destChatId;
    }

    await sendText(destChatId, text);
    await db.reportDispatch.create({
      data: { senderId: user.id, reportKey: key, periodStart, periodEnd, destName, destChatId, text },
    });
    await audit(user.id, "exec_report.send", "report_dispatch", null, { reportKey: key, destChatId });
    revalidatePath("/laporan-wa");
    revalidatePath("/kontak-wa");
    return { success: `Terkirim ke ${destName}.` };
  } catch (err) {
    return fail(err);
  }
}

/* ── Kontak WA (per-pembuat) ─────────────────────────────────────────────── */

export type ContactState = { error?: string; success?: string } | undefined;

const contactSchema = z.object({
  name: z.string().trim().min(1, "Nama kontak wajib diisi").max(120),
  chatId: z.string().trim().min(3, "Tujuan WA wajib diisi").max(120),
  note: z.string().trim().max(200).optional(),
});

export async function addWaContactAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  try {
    const user = await requireCapability("exec_report.send");
    const parsed = contactSchema.safeParse({
      name: formData.get("name") ?? "",
      chatId: formData.get("chatId") ?? "",
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const chatId = normalizeWaTarget(parsed.data.chatId);
    await db.waContact.create({
      data: { ownerId: user.id, name: parsed.data.name, chatId, note: parsed.data.note || null },
    });
    revalidatePath("/laporan-wa");
    revalidatePath("/kontak-wa");
    return { success: `Kontak "${parsed.data.name}" disimpan.` };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteWaContactAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  try {
    const user = await requireCapability("exec_report.send");
    const id = String(formData.get("id") ?? "");
    if (!z.uuid().safeParse(id).success) return { error: "Kontak tidak valid." };
    await db.waContact.deleteMany({ where: { id, ownerId: user.id } });
    revalidatePath("/laporan-wa");
    revalidatePath("/kontak-wa");
    return { success: "Kontak dihapus." };
  } catch (err) {
    return fail(err);
  }
}
