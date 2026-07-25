import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { isWaMessageEvent, parseWaEvent } from "./ingest-parse";

/**
 * Ingest event webhook WAHA → tabel wa_messages. Cakupan: HANYA pesan dari grup
 * yang tertaut paket (Package.waGroupId). Dedup via wa_message_id. DECISIONS 119.
 */
export type IngestResult = { stored: boolean; reason?: string; packageId?: string };

export async function ingestWaEvent(body: unknown): Promise<IngestResult> {
  if (!isWaMessageEvent(body)) return { stored: false, reason: "bukan event pesan" };
  const m = parseWaEvent(body);
  if (!m) return { stored: false, reason: "payload tidak dikenali" };

  // Cakupan: hanya grup tertaut paket (privasi + relevansi). Grup lain diabaikan.
  const pkg = await db.package.findFirst({
    where: { waGroupId: m.chatId },
    select: { id: true },
  });
  if (!pkg) return { stored: false, reason: "grup tidak tertaut paket" };

  await db.waMessage.upsert({
    where: { waMessageId: m.waMessageId },
    update: {}, // idempoten — pesan sama tidak ditimpa
    create: {
      packageId: pkg.id,
      chatId: m.chatId,
      waMessageId: m.waMessageId,
      fromNumber: m.fromNumber,
      fromName: m.fromName,
      body: m.body,
      hasMedia: m.hasMedia,
      mediaType: m.mediaType,
      fromMe: m.fromMe,
      timestamp: m.timestamp,
      raw: body as Prisma.InputJsonValue,
    },
  });
  return { stored: true, packageId: pkg.id };
}
