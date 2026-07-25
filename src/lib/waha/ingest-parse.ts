/**
 * Parser MURNI event webhook WAHA → bentuk pesan yang kita simpan. Tanpa DB /
 * server-only supaya bisa diuji unit langsung. Bentuk payload beda antar versi
 * WAHA (Core/Plus, WEBJS/NOWEB); kita baca defensif dengan banyak fallback.
 * DECISIONS 119.
 */

export type ParsedWaMessage = {
  waMessageId: string;
  chatId: string;
  fromNumber: string | null;
  fromName: string | null;
  body: string;
  hasMedia: boolean;
  mediaType: string | null;
  fromMe: boolean;
  timestamp: Date;
};

type AnyObj = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Buang suffix @c.us / @g.us / @s.whatsapp.net → nomor polos. */
function bareNumber(jid: string | null): string | null {
  if (!jid) return null;
  return jid.replace(/@.*$/, "").replace(/[^0-9+]/g, "") || null;
}

/** Hanya event pesan yang kita tangani (message / message.any). */
export function isWaMessageEvent(body: unknown): boolean {
  const e = (body as AnyObj)?.event;
  return e === "message" || e === "message.any";
}

export function parseWaEvent(body: unknown): ParsedWaMessage | null {
  const root = body as AnyObj;
  if (!isWaMessageEvent(root)) return null;
  const p = (root.payload ?? {}) as AnyObj;
  const data = (p._data ?? {}) as AnyObj;

  const waMessageId = str(p.id) ?? str(data.id) ?? str((data.id as AnyObj)?._serialized);
  const chatId = str(p.from) ?? str(p.chatId) ?? str(data.from);
  if (!waMessageId || !chatId) return null;

  const isGroup = chatId.endsWith("@g.us");
  // Di grup, `from` = grup dan `author`/`participant` = pengirim sebenarnya.
  const senderJid = isGroup
    ? str(p.author) ?? str(p.participant) ?? str(data.author)
    : chatId;

  const timestampSec =
    typeof p.timestamp === "number"
      ? p.timestamp
      : typeof data.t === "number"
        ? data.t
        : null;

  const media = (p.media ?? {}) as AnyObj;

  return {
    waMessageId,
    chatId,
    fromNumber: bareNumber(senderJid),
    fromName: str(p.notifyName) ?? str(data.notifyName) ?? str(p.pushName) ?? null,
    body: str(p.body) ?? str(p.caption) ?? "",
    hasMedia: p.hasMedia === true || !!media.url || !!media.mimetype,
    mediaType: str(media.mimetype) ?? str(p.type) ?? str(data.type) ?? null,
    fromMe: p.fromMe === true || data.fromMe === true,
    timestamp: timestampSec != null ? new Date(timestampSec * 1000) : new Date(0),
  };
}
