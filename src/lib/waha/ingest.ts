import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { isWaMessageEvent, parseWaEvent } from "./ingest-parse";
import { recordWahaInbound } from "./config";

/**
 * Ingest event webhook WAHA → tabel wa_messages. Cakupan: HANYA pesan dari grup
 * yang tertaut paket (Package.waGroupId). Dedup via wa_message_id. DECISIONS 119.
 */
export type IngestResult = { stored: boolean; reason?: string; packageId?: string; chatId?: string };

export async function ingestWaEvent(body: unknown): Promise<IngestResult> {
  const eventName = (body as { event?: unknown })?.event;
  if (!isWaMessageEvent(body)) {
    console.log(`[waha] event diabaikan (bukan pesan): ${String(eventName)}`);
    return { stored: false, reason: "bukan event pesan" };
  }
  const m = parseWaEvent(body);
  if (!m) {
    console.warn(`[waha] pesan gagal diparse. keys=${Object.keys((body as { payload?: object })?.payload ?? {}).join(",")}`);
    await recordWahaInbound({ chatId: null, stored: false, reason: "payload tidak dikenali" });
    return { stored: false, reason: "payload tidak dikenali" };
  }

  // Cakupan: hanya grup tertaut paket (privasi + relevansi). Grup lain diabaikan.
  const pkg = await db.package.findFirst({
    where: { waGroupId: m.chatId },
    select: { id: true },
  });
  if (!pkg) {
    console.warn(
      `[waha] pesan DIBUANG — grup "${m.chatId}" belum tertaut paket. ` +
        `Tautkan chatId ini di Paket → Grup WhatsApp. from=${m.fromNumber ?? "?"} body="${m.body.slice(0, 40)}"`,
    );
    await recordWahaInbound({ chatId: m.chatId, stored: false, reason: "grup tidak tertaut paket" });
    return { stored: false, reason: "grup tidak tertaut paket", chatId: m.chatId };
  }

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
  console.log(`[waha] TERSIMPAN pesan grup "${m.chatId}" → paket ${pkg.id} (from=${m.fromNumber ?? "?"})`);
  await recordWahaInbound({ chatId: m.chatId, stored: true });
  return { stored: true, packageId: pkg.id, chatId: m.chatId };
}
