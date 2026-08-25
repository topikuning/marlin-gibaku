import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { isWaMessageEvent, kerangkaPayload, parseWaEvent } from "./ingest-parse";
import { kanonikGrupId } from "./grup-id";

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
    /*
     * Payload UTUH ke log server (DECISIONS 348) — di sinilah, dan hanya di
     * sini, "log full raw payload" itu aman: log Railway berakses terbatas,
     * sedangkan log hit di Sistem dibaca admin lain dan tidak boleh memuat isi
     * chat pribadi. Daftar nama medan saja ternyata tidak cukup: bentuk mentah
     * NOWEB menaruh chatId di `key.remoteJid`, yang tak terlihat dari `keys=`.
     */
    console.warn("[waha] pesan gagal diparse. payload utuh:", JSON.stringify(body)?.slice(0, 4000));
    return { stored: false, reason: `payload tidak dikenali – ${kerangkaPayload(body)}` };
  }

  /*
   * Cakupan: hanya grup tertaut paket (privasi + relevansi). Grup lain diabaikan.
   *
   * Dicocokkan dengan bentuk KANONIK, satu lawan satu (DECISIONS 370).
   * Sebelumnya di sini dipakai `findFirst` atas seluruh varian tulisan
   * (DECISIONS 348) karena baris lama menyimpan bentuk apa pun yang kebetulan
   * datang. Migration `20260819120000_wa_group_unik` mengkanonikkan seluruh
   * baris dan memasang indeks unik, jadi pencocokan longgar tidak lagi
   * diperlukan — dan pencocokan longgar itulah yang membuat paket mana yang
   * terpilih bergantung pada urutan baris.
   */
  const kanonik = kanonikGrupId(m.chatId);
  const pkg = kanonik
    ? await db.package.findUnique({ where: { waGroupId: kanonik }, select: { id: true } })
    : null;
  if (!pkg) {
    // Chat PRIBADI memang tidak pernah disimpan — itu bukan kesalahan
    // penautan, dan sejak tanya-jawab bebas (DECISIONS 339) chat pribadi
    // adalah saluran yang sah. Menyebutnya "DIBUANG — belum tertaut paket"
    // mengirim admin memburu tautan grup yang tidak pernah ada.
    if (!m.chatId.endsWith("@g.us")) {
      return { stored: false, reason: "chat pribadi (tidak diarsipkan)", chatId: m.chatId };
    }
    console.warn(
      `[waha] pesan DIBUANG – grup "${m.chatId}" belum tertaut paket. ` +
        `Tautkan chatId ini di Paket → Grup WhatsApp. from=${m.fromNumber ?? "?"} body="${m.body.slice(0, 40)}"`,
    );
    return { stored: false, reason: "grup tidak tertaut paket", chatId: m.chatId };
  }

  try {
    await db.waMessage.upsert({
      where: { waMessageId: m.waMessageId },
      update: {}, // idempoten — pesan sama tidak ditimpa
      create: {
        packageId: pkg.id,
        chatId: m.chatId,
        waMessageId: m.waMessageId,
        senderJid: m.senderJid,
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
  } catch (err) {
    // Race idempoten: pesan sama tiba lewat `message` + `message.any` berbarengan
    // → dua INSERT dengan wa_message_id sama. Salah satu menang; yang kalah kena
    // unique violation (P2002). Perlakukan sebagai sudah tersimpan — BUKAN error.
    if (err && typeof err === "object" && (err as { code?: unknown }).code === "P2002") {
      return { stored: true, packageId: pkg.id, chatId: m.chatId };
    }
    throw err;
  }
  console.log(`[waha] TERSIMPAN pesan grup "${m.chatId}" → paket ${pkg.id} (from=${m.fromNumber ?? "?"})`);
  return { stored: true, packageId: pkg.id, chatId: m.chatId };
}
