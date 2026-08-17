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
  /**
   * JID pemilik pesan yang DIBALAS (quote), bila pesan ini sebuah balasan
   * (DECISIONS 349).
   *
   * Membalas pesan MARLIN adalah cara orang benar-benar meneruskan percakapan
   * di grup, dan WhatsApp tidak selalu menyertakan mention di situ.
   */
  balasanKepada: string | null;
};

import { toInternationalId } from "@/lib/contacts/model";

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

/**
 * Bentuk KANONIK chat id — satu tulisan untuk satu chat (DECISIONS 348).
 *
 * ### Kenapa ini wajib, bukan kerapian
 *
 * Chat yang SAMA ditulis berbeda-beda tergantung engine & versi WAHA:
 *
 * | yang datang | engine |
 * | --- | --- |
 * | `6281234757999@c.us` | WEBJS |
 * | `6281234757999@s.whatsapp.net` | NOWEB |
 * | `6281234757999:12@s.whatsapp.net` | NOWEB, perangkat ke-12 |
 * | `6281234757999` | sebagian payload `chatId` |
 *
 * Padahal `Package.waGroupId` dicocokkan sebagai TEKS (`where: { waGroupId }`),
 * dan tujuan kirim dipakai apa adanya oleh `sendText`. Satu huruf beda = tidak
 * pernah cocok, tanpa galat apa pun — persis cacat nomor pengguna di
 * DECISIONS 345, di lapisan yang berbeda.
 *
 * ### Sufiks perangkat `:12` — yang paling berbahaya
 *
 * Diukur sebelum perbaikan ini: `6281234757999:12@s.whatsapp.net` menghasilkan
 * nomor **628123475799912**. Bukan cuma tidak cocok — ia nomor yang salah, dan
 * kalau kebetulan ada pemilik aslinya, jawabannya pergi ke orang itu.
 *
 * ### Yang TIDAK ditebak
 *
 * `@lid`, `@g.us`, `@broadcast`, `@newsletter` dibiarkan apa adanya — masing-
 * masing ruang identitas sendiri. Angka telanjang dibedakan lewat bentuknya:
 * id grup panjang (≥16 angka) atau memuat `-`; nomor telepon 8–15 angka. Di
 * luar itu dikembalikan apa adanya, karena menebak alamat kirim yang salah
 * lebih buruk daripada mengaku tidak tahu.
 */
export function normalizeChatId(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().replace(/\s+/g, "").replace(/^\+/, "");
  if (!t) return null;

  const at = t.lastIndexOf("@");
  if (at === -1) {
    if (/-/.test(t) || /^\d{16,}$/.test(t)) return `${t}@g.us`;
    if (/^\d{8,15}$/.test(t)) return `${toInternationalId(t)}@c.us`;
    return t;
  }

  // Sufiks perangkat (`:12`) dan agen (`_1`) bukan bagian identitas chat.
  const lokal = t.slice(0, at).replace(/[:_].*$/, "");
  const domain = t.slice(at + 1).toLowerCase();
  if (!lokal) return null;
  // NOWEB dan WEBJS menulis kontak yang SAMA dengan dua domain berbeda.
  if (domain === "s.whatsapp.net" || domain === "c.us") return `${lokal}@c.us`;
  return `${lokal}@${domain}`;
}

/**
 * Semua tulisan yang berarti chat yang SAMA — untuk mencocokkan data LAMA.
 *
 * Baris `Package.waGroupId` yang sudah tersimpan sebelum kanonikalisasi ini
 * memakai bentuk apa pun yang kebetulan datang saat itu. Menormalkan hanya sisi
 * masuk akan memutus tautan grup yang selama ini bekerja — memperbaiki satu hal
 * sambil merusak yang lain. Jadi pencocokan dilakukan terhadap SELURUH varian,
 * dan datanya tidak perlu diubah.
 */
export function varianChatId(raw: string | null | undefined): string[] {
  const kanonik = normalizeChatId(raw);
  if (!kanonik) return [];
  const keluar = new Set<string>([kanonik]);
  if (raw) keluar.add(raw.trim());
  const at = kanonik.lastIndexOf("@");
  const lokal = at === -1 ? kanonik : kanonik.slice(0, at);
  const domain = at === -1 ? "" : kanonik.slice(at + 1);
  if (domain === "c.us") keluar.add(`${lokal}@s.whatsapp.net`);
  if (domain === "g.us" || domain === "c.us") keluar.add(lokal);
  return [...keluar];
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
  /*
   * Bentuk MENTAH Baileys (engine NOWEB) menaruh semuanya di `key`, dan versi
   * pertama berkas ini tidak membacanya sama sekali. Diukur: seluruh pesan
   * berbentuk itu dikembalikan `null` — dibuang sebelum apa pun sempat terjadi,
   * termasuk pesan grup yang sudah tertaut paket. DECISIONS 348.
   */
  const key = (p.key ?? data.key ?? {}) as AnyObj;

  const waMessageId =
    str(p.id) ?? str(data.id) ?? str((data.id as AnyObj)?._serialized) ?? str(key.id);
  const fromMe = p.fromMe === true || data.fromMe === true || key.fromMe === true;
  // Pesan KELUAR (fromMe): WAHA mengisi `from` = nomor kita sendiri dan `to` =
  // chat tujuan. Tanpa membaca `to`, kiriman MARLIN ke grup tak pernah cocok
  // dengan Package.waGroupId → dibuang, sehingga ringkasan harian tidak utuh.
  const chatIdMentah = fromMe
    ? (str(p.to) ?? str(data.to) ?? str(p.chatId) ?? str(p.from) ?? str(key.remoteJid))
    : (str(p.from) ?? str(p.chatId) ?? str(data.from) ?? str(key.remoteJid));
  // Dikanonikkan SEKALI di sini, supaya seluruh sistem hilir — pencocokan
  // paket, pencarian pengguna, alamat balasan — melihat satu bentuk saja.
  const chatId = normalizeChatId(chatIdMentah);
  if (!waMessageId || !chatId) return null;

  const isGroup = chatId.endsWith("@g.us");
  // Di grup, `from` = grup dan `author`/`participant` = pengirim sebenarnya.
  // Untuk pesan keluar, pengirim = kita (`from`).
  const senderJid = normalizeChatId(
    isGroup
      ? fromMe
        ? (str(p.author) ?? str(p.from))
        : (str(p.author) ?? str(p.participant) ?? str(data.author) ?? str(key.participant))
      : fromMe
        ? (str(p.from) ?? chatId)
        : chatId,
  );

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
    balasanKepada: bacaBalasanKepada(p, data),
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
  const key = (p.key ?? data.key ?? {}) as AnyObj;
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
  pindai(key, "key.");
  return keluar.join(" ");
}

/** Medan payload yang isinya PESAN — tidak pernah boleh ikut tercatat. */
const MEDAN_ISI = /^(body|caption|text|conversation|content|message|quoted|media|data|base64|thumbnail)/i;

/**
 * Kerangka payload untuk dicatat di log Sistem (DECISIONS 348).
 *
 * User meminta *"log full raw payload"* — tepat sebagai keinginan diagnosa,
 * dan itu memang jalan tercepat menemukan nama medan yang berubah antar engine.
 * Tapi log hit di **Sistem → WhatsApp** dibaca admin lain, dan payload utuh
 * memuat ISI pesan pribadi. Menyalakannya berarti setiap chat pribadi yang
 * gagal diproses ikut terbit di halaman yang bisa dibuka orang lain.
 *
 * Jadi dipisah: payload UTUH ke log server (Railway — akses terbatas), dan
 * KERANGKA-nya ke Sistem. Kerangka menyebut setiap medan beserta TIPE dan
 * panjangnya; nilainya hanya ditulis kalau pendek dan bukan medan isi pesan.
 * Untuk menemukan "chatId ada di mana", itu sama berguna dengan payload utuh.
 */
export function kerangkaPayload(body: unknown, batas = 400): string {
  const p = ((body as AnyObj)?.payload ?? {}) as AnyObj;
  const keluar: string[] = [];
  const pindai = (obj: AnyObj, awalan: string, dalam: number) => {
    for (const [k, v] of Object.entries(obj)) {
      const nama = `${awalan}${k}`;
      if (v && typeof v === "object" && !Array.isArray(v) && dalam < 2) {
        pindai(v as AnyObj, `${nama}.`, dalam + 1);
      } else if (Array.isArray(v)) {
        keluar.push(`${nama}[${v.length}]`);
      } else if (typeof v === "string") {
        // Medan isi pesan: panjangnya saja, tidak pernah isinya.
        keluar.push(MEDAN_ISI.test(k) || v.length > 40 ? `${nama}:str(${v.length})` : `${nama}=${v}`);
      } else if (v !== null && v !== undefined) {
        keluar.push(`${nama}=${String(v)}`);
      }
    }
  };
  pindai(p, "", 0);
  const s = keluar.join(" ");
  return s.length > batas ? `${s.slice(0, batas)}…` : s;
}

/**
 * JID pemilik pesan yang dibalas (DECISIONS 349) — dinormalkan seperti JID lain
 * supaya bisa dibandingkan langsung dengan identitas MARLIN.
 */
function bacaBalasanKepada(p: AnyObj, data: AnyObj): string | null {
  const pesan = (p.message ?? data.message ?? {}) as AnyObj;
  const konteks = [
    p.contextInfo,
    data.contextInfo,
    (p._data as AnyObj)?.contextInfo,
    (pesan.extendedTextMessage as AnyObj)?.contextInfo,
  ].filter(Boolean) as AnyObj[];
  const kandidat = [
    ...konteks.map((c) => c.participant),
    (p.replyTo as AnyObj)?.participant,
    (p.replyTo as AnyObj)?.author,
    data.quotedParticipant,
    (p._data as AnyObj)?.quotedParticipant,
    (p.quotedMsg as AnyObj)?.author,
  ];
  for (const v of kandidat) {
    const s = typeof v === "string" ? v : str((v as AnyObj)?._serialized);
    const n = normalizeChatId(s);
    if (n) return n;
  }
  return null;
}

/**
 * Kumpulkan JID yang di-mention dari berbagai bentuk payload WAHA.
 *
 * Termasuk `contextInfo.mentionedJid` yang BERSARANG (DECISIONS 349): engine
 * NOWEB menaruh penyebutan di `message.extendedTextMessage.contextInfo`, bukan
 * di permukaan payload. Selama itu tidak dibaca, mention di grup terlihat
 * seperti tidak ada — dan MARLIN diam pada pesan yang jelas memanggilnya.
 */
function bacaMention(p: AnyObj, data: AnyObj): string[] {
  const pesan = (p.message ?? data.message ?? {}) as AnyObj;
  const konteks = [
    p.contextInfo,
    data.contextInfo,
    (pesan.extendedTextMessage as AnyObj)?.contextInfo,
    (pesan.imageMessage as AnyObj)?.contextInfo,
    (pesan.videoMessage as AnyObj)?.contextInfo,
    (pesan.documentMessage as AnyObj)?.contextInfo,
  ].filter(Boolean) as AnyObj[];

  const sumber = [
    p.mentionedIds,
    p.mentionedJidList,
    (p._data as AnyObj)?.mentionedJidList,
    (p._data as AnyObj)?.contextInfo && ((p._data as AnyObj).contextInfo as AnyObj).mentionedJid,
    data.mentionedIds,
    data.mentionedJidList,
    (p.mentions as AnyObj[] | undefined),
    ...konteks.map((c) => c.mentionedJid),
    ...konteks.map((c) => c.mentionedJidList),
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
