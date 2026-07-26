/**
 * Parser MURNI event webhook WAHA → bentuk pesan yang kita simpan. Tanpa DB /
 * server-only supaya bisa diuji unit langsung. Bentuk payload beda antar versi
 * WAHA (Core/Plus, WEBJS/NOWEB); kita baca defensif dengan banyak fallback.
 * DECISIONS 119.
 */

export type ParsedWaMessage = {
  waMessageId: string;
  chatId: string;
  /** JID mentah pengirim (…@c.us / …@lid) — @lid TIDAK memuat nomor telepon. */
  senderJid: string | null;
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

/**
 * Buang suffix @c.us / @g.us / @s.whatsapp.net → nomor polos.
 * JID ber-suffix @lid adalah identitas privasi WhatsApp (BUKAN nomor telepon)
 * → kembalikan null supaya tidak pernah tampil sebagai "nomor". DECISIONS 138.
 */
function bareNumber(jid: string | null): string | null {
  if (!jid) return null;
  if (/@lid$/i.test(jid)) return null;
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
  const fromMe = p.fromMe === true || data.fromMe === true;
  // Pesan KELUAR (fromMe): WAHA mengisi `from` = nomor kita sendiri dan `to` =
  // chat tujuan. Tanpa membaca `to`, kiriman MARLIN ke grup tak pernah cocok
  // dengan Package.waGroupId → dibuang, sehingga ringkasan harian tidak utuh.
  const chatId = fromMe
    ? (str(p.to) ?? str(data.to) ?? str(p.chatId) ?? str(p.from))
    : (str(p.from) ?? str(p.chatId) ?? str(data.from));
  if (!waMessageId || !chatId) return null;

  const isGroup = chatId.endsWith("@g.us");
  // Di grup, `from` = grup dan `author`/`participant` = pengirim sebenarnya.
  // Untuk pesan keluar, pengirim = kita (`from`).
  const senderJid = isGroup
    ? (fromMe ? (str(p.author) ?? str(p.from)) : (str(p.author) ?? str(p.participant) ?? str(data.author)))
    : fromMe
      ? (str(p.from) ?? chatId)
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
    senderJid,
    fromNumber: bareNumber(senderJid),
    // Nama tampilan WhatsApp bisa datang di banyak field tergantung versi/engine
    // WAHA (WEBJS/NOWEB, Core/Plus) — baca defensif supaya tidak jatuh ke nomor.
    fromName:
      str(p.notifyName) ??
      str(data.notifyName) ??
      str(p.pushName) ??
      str(data.pushName) ??
      str((p.contact as AnyObj)?.name) ??
      str((p.contact as AnyObj)?.pushname) ??
      str((p._data as AnyObj)?.verifiedBizName) ??
      str(p.participantName) ??
      str(data.senderName) ??
      null,
    body: str(p.body) ?? str(p.caption) ?? "",
    hasMedia: p.hasMedia === true || !!media.url || !!media.mimetype,
    mediaType: str(media.mimetype) ?? str(p.type) ?? str(data.type) ?? null,
    fromMe,
    timestamp: timestampSec != null ? new Date(timestampSec * 1000) : new Date(0),
  };
}
