import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { aiCall } from "@/lib/ai/client";
import { parseDateKey } from "@/lib/format";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Ringkasan AI harian percakapan grup WA per paket — Layer B dari penangkap
 * pesan (DECISIONS 119 → 135). Sumber = arsip WaMessage (grup tertaut paket);
 * satu ringkasan per (paket, tanggal Jakarta), regenerate menimpa.
 */

const MAX_MESSAGES = 500;
const MAX_CHARS = 45_000;

/** Batas hari Jakarta (UTC+7): [00:00, 24:00) tanggal tsb. */
export function jakartaDayRange(dateKey: string): { start: Date; end: Date } | null {
  if (!parseDateKey(dateKey)) return null;
  const start = new Date(`${dateKey}T00:00:00.000+07:00`);
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
}

export type ChatDay = { dateKey: string; count: number };

/** Hari-hari (Jakarta) yang punya pesan utk satu paket + jumlahnya (terbaru dulu). */
export async function listChatDays(packageId: string, limit = 30): Promise<ChatDay[]> {
  const rows = await db.$queryRaw<{ d: string; cnt: bigint }[]>`
    SELECT to_char(timestamp AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS d,
           COUNT(*)::bigint AS cnt
    FROM wa_messages
    WHERE package_id = ${packageId}::uuid
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ dateKey: r.d, count: Number(r.cnt) }));
}

export type ChatMessageView = {
  id: string;
  fromName: string | null;
  body: string;
  hasMedia: boolean;
  timeLabel: string; // HH:mm WIB
};

/** Pesan satu hari (Jakarta) utk tampilan + bahan prompt. */
export async function getChatMessages(packageId: string, dateKey: string): Promise<ChatMessageView[]> {
  const range = jakartaDayRange(dateKey);
  if (!range) return [];
  const msgs = await db.waMessage.findMany({
    where: { packageId, timestamp: { gte: range.start, lt: range.end } },
    orderBy: { timestamp: "asc" },
    take: MAX_MESSAGES,
    select: { id: true, fromName: true, fromNumber: true, body: true, hasMedia: true, timestamp: true },
  });
  return msgs.map((m) => ({
    id: m.id,
    fromName: m.fromName ?? m.fromNumber ?? "Anggota",
    body: m.body,
    hasMedia: m.hasMedia,
    timeLabel: m.timestamp.toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
}

const SYSTEM_PROMPT = `Anda merangkum percakapan grup WhatsApp proyek konstruksi Kampung Nelayan Merah Putih untuk manajemen.
Aturan:
- Bahasa Indonesia operasional, langsung, tanpa basa-basi.
- HANYA dari isi chat — jangan mengarang progres/angka yang tidak disebut.
- Struktur ringkasan: (1) Progres & aktivitas yang dilaporkan, (2) Kendala/masalah, (3) Keputusan & instruksi, (4) Permintaan/butuh tindak lanjut (sebut siapa), (5) Catatan lain. Bagian kosong ditiadakan.
- Sebut nama pengirim untuk hal penting. Maksimum ~250 kata.`;

export type SummaryResult = { ok: true; summaryText: string } | { ok: false; error: string };

/**
 * Buat/perbarui ringkasan harian satu paket. Idempotent per (paket, tanggal) —
 * upsert. Truncation dicatat di ringkasan bila chat melebihi batas.
 */
export async function generateChatSummary(
  user: SessionUser,
  packageId: string,
  dateKey: string,
): Promise<SummaryResult> {
  const pkg = await db.package.findFirst({
    where: { id: packageId, orgId: user.orgId },
    select: { id: true, name: true, waGroupName: true },
  });
  if (!pkg) return { ok: false, error: "Paket tidak ditemukan." };
  const messages = await getChatMessages(packageId, dateKey);
  if (messages.length === 0) return { ok: false, error: "Tidak ada pesan pada tanggal ini." };

  let transcript = "";
  let truncated = false;
  for (const m of messages) {
    const line = `[${m.timeLabel}] ${m.fromName}: ${m.body}${m.hasMedia ? " [media]" : ""}\n`;
    if (transcript.length + line.length > MAX_CHARS) {
      truncated = true;
      break;
    }
    transcript += line;
  }

  const result = await aiCall({
    system: SYSTEM_PROMPT,
    prompt:
      `Grup: ${pkg.waGroupName ?? pkg.name} · Paket: ${pkg.name} · Tanggal: ${dateKey} · ${messages.length} pesan` +
      (truncated ? " (sebagian terpotong karena panjang)" : "") +
      `\n\n=== TRANSKRIP ===\n${transcript}`,
    maxTokens: 1200,
    timeoutMs: 90_000,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const summaryText = truncated
    ? `${result.text}\n\n(Catatan: chat hari ini sangat panjang — ringkasan dibuat dari ${MAX_CHARS.toLocaleString("id-ID")} karakter pertama.)`
    : result.text;

  await db.waChatSummary.upsert({
    where: { packageId_summaryDate: { packageId, summaryDate: new Date(`${dateKey}T00:00:00.000Z`) } },
    update: {
      messageCount: messages.length,
      summaryText,
      provider: result.provider,
      model: result.model,
      createdById: user.id,
    },
    create: {
      packageId,
      summaryDate: new Date(`${dateKey}T00:00:00.000Z`),
      messageCount: messages.length,
      summaryText,
      provider: result.provider,
      model: result.model,
      createdById: user.id,
    },
  });
  await audit(user.id, "wa.chat_summary", "package", packageId, {
    dateKey,
    messages: messages.length,
    provider: result.provider,
  });
  return { ok: true, summaryText };
}
