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
  /**
   * JID @lid pengirim, bila ada (DECISIONS 347).
   *
   * WhatsApp kini mengirim sebagian chat dengan identitas privasi `@lid`
   * alih-alih JID bernomor. `fromNumber` sengaja null untuk itu — @lid BUKAN
   * nomor telepon — tapi LID-nya sendiri stabil per orang, jadi ia tetap bisa
   * dipakai mengenali penanya lewat pemetaan yang disetel admin.
   */
  senderLid: string | null;
  /**
   * JID yang di-MENTION di pesan ini (DECISIONS 338).
   *
   * Di grup, MARLIN hanya menjawab kalau ia disebut — dan penyebutan itu harus
   * dibaca dari daftar JID, BUKAN dari teks "@marlin" di badan pesan. Nama
   * tampilan bisa diubah siapa saja; JID tidak. Bentuk medannya berbeda antar
   * engine WAHA, jadi dibaca defensif seperti medan lain di berkas ini.
   */
  mentionedJids: string[];
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
    // Untuk chat @lid, nomornya dicari di medan pasangan yang dibawa payload.
    fromNumber: bareNumber(senderJid) ?? (isLid(senderJid) ? nomorDariLid(p, data) : null),
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
    mentionedJids: bacaMention(p, data),
    senderLid: isLid(senderJid) ? senderJid : null,
  };
}

function isLid(jid: string | null): boolean {
  return !!jid && /@lid$/i.test(jid);
}

/**
 * Nomor telepon pengirim untuk chat ber-identitas `@lid` (DECISIONS 347).
 *
 * WhatsApp membawa DUA identitas untuk orang yang sama: `@lid` (privasi) dan
 * JID bernomor. Nama medan yang memuat pasangannya berbeda antar versi & engine
 * WAHA, dan dokumentasinya tidak terjangkau dari lingkungan kerja ini — jadi
 * dibaca DEFENSIF dari daftar kandidat, persis seperti `fromName` di atas.
 *
 * Kalau tak satu pun ada, hasilnya null dan pemanggil jatuh ke pemetaan LID
 * yang disetel admin. Yang TIDAK dilakukan: menebak nomor dari LID-nya —
 * angkanya bukan nomor telepon, dan memperlakukannya sebagai nomor akan
 * menautkan pesan ke orang yang salah.
 */
function nomorDariLid(p: AnyObj, data: AnyObj): string | null {
  const kandidat = [
    p.senderPn,
    p.participantPn,
    p.authorPn,
    p.participantAlt,
    p.authorAlt,
    p.fromAlt,
    data.senderPn,
    data.participantPn,
    data.participantAlt,
    data.authorAlt,
    (data.id as AnyObj)?.participant,
    (p._data as AnyObj)?.senderPn,
    (p._data as AnyObj)?.participantAlt,
  ];
  for (const v of kandidat) {
    const s = typeof v === "string" ? v : str((v as AnyObj)?._serialized);
    if (!s || /@lid$/i.test(s)) continue;
    const nomor = s.replace(/@.*$/, "").replace(/[^0-9]/g, "");
    if (nomor.length >= 8) return nomor;
  }
  return null;
}

/**
 * Medan yang BENAR-BENAR ada di payload, untuk diagnosa (DECISIONS 347).
 *
 * Hanya NAMA medan dan nilai yang berbentuk JID — bukan isi pesan. Dipakai saat
 * pengirim ber-@lid dan nomornya tidak ketemu: tanpa ini, menutup celahnya
 * berarti menebak nama medan berulang kali lewat rilis, satu tebakan per hari.
 */
export function medanJidPayload(body: unknown): string {
  const p = ((body as AnyObj)?.payload ?? {}) as AnyObj;
  const data = (p._data ?? {}) as AnyObj;
  const keluar: string[] = [];
  const pindai = (obj: AnyObj, awalan: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== "string") continue;
      if (/@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i.test(v) || /^\d{8,}$/.test(v)) {
        keluar.push(`${awalan}${k}=${v}`);
      }
    }
  };
  pindai(p, "");
  pindai(data, "_data.");
  return keluar.join(" ");
}

/** Kumpulkan JID yang di-mention dari berbagai bentuk payload WAHA. */
function bacaMention(p: AnyObj, data: AnyObj): string[] {
  const sumber = [
    p.mentionedIds,
    p.mentionedJidList,
    (p._data as AnyObj)?.mentionedJidList,
    data.mentionedIds,
    data.mentionedJidList,
    (p.mentions as AnyObj[] | undefined),
  ];
  const keluar = new Set<string>();
  for (const s of sumber) {
    if (!Array.isArray(s)) continue;
    for (const v of s) {
      // Bentuknya bisa string JID, atau objek { id } / { _serialized }.
      const jid =
        typeof v === "string"
          ? v
          : str((v as AnyObj)?._serialized) ??
            str((v as AnyObj)?.id) ??
            str((v as AnyObj)?.jid);
      if (jid) keluar.add(jid.trim());
    }
  }
  return [...keluar];
}
