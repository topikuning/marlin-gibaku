import "server-only";
import { getWahaConfig } from "@/lib/waha/config";
import { wajibKanonikGrupId } from "./grup-id";

/**
 * Klien WAHA (WhatsApp HTTP API) — https://waha.devlike.pro.
 *
 * WAHA di-host terpisah (Docker/Railway). Config (URL + API key + sesi) dibaca
 * dari SETTING APLIKASI di DB (lihat waha/config.ts), bukan environment. Kita
 * hanya bicara REST:
 * - POST /api/sendText   { session, chatId, text }
 * - POST /api/sendImage  { session, chatId, file:{mimetype,filename,data|url}, caption }
 * - POST /api/sendFile   { session, chatId, file:{mimetype,filename,data|url}, caption }
 * - GET  /api/{session}/groups            → daftar grup
 * - GET  /api/sessions/{session}          → status sesi (WORKING / SCAN_QR_CODE / ...)
 * Auth: header `X-Api-Key: <api key>`.
 *
 * File dikirim sebagai base64 (`file.data`) dari byte yang kita ambil sendiri
 * dari R2 — supaya tidak bergantung pada WAHA bisa menjangkau presigned URL kita.
 */

export class WahaError extends Error {
  /**
   * Kode HTTP dari WAHA, bila galatnya memang berasal dari respons — bukan
   * dari kegagalan koneksi.
   *
   * Dibutuhkan gateway pengiriman untuk membedakan DITOLAK dari GAGAL
   * (DECISIONS 374). WhatsApp menolak nomor yang tidak terdaftar dengan 4xx
   * (mis. 463); mengulanginya tidak akan pernah berhasil, jadi ia tidak boleh
   * masuk antrean coba-lagi. Kegagalan jaringan sebaliknya: memang layak
   * diulang.
   */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

// Re-export supaya pemanggil lama tetap jalan (isWahaConfigured async, dari DB).
export { isWahaConfigured } from "@/lib/waha/config";

/** Ambil config atau lempar error ramah kalau belum diatur. */
async function cfg() {
  const c = await getWahaConfig();
  if (!c) {
    throw new WahaError(
      "Integrasi WhatsApp (WAHA) belum dikonfigurasi — atur URL & API key di halaman Sistem.",
    );
  }
  return c;
}

/**
 * Format chatId grup — SATU pintu, sekarang menumpang `wajibKanonikGrupId`
 * (DECISIONS 370).
 *
 * Versi lamanya mengembalikan teks apa adanya begitu berakhiran `@g.us`,
 * sehingga sufiks perangkat (`:12`) dan domain berhuruf besar tersimpan utuh —
 * bentuk yang tidak akan pernah sama persis dengan yang datang dari webhook,
 * yang memang dikanonikkan. Dua normalisasi yang tidak setuju itulah sebab
 * pembacaan terpaksa mencocokkan seluruh varian dengan `findFirst()`.
 *
 * Dibiarkan tetap melempar `WahaError` supaya pemanggil lama yang menangkapnya
 * tidak berubah perilaku.
 */
export function normalizeGroupChatId(raw: string): string {
  try {
    return wajibKanonikGrupId(raw);
  } catch (err) {
    throw new WahaError(err instanceof Error ? err.message : "ID grup tidak valid.");
  }
}

type ResolvedCfg = { baseUrl: string; apiKey: string; session: string };

/**
 * Terjemahkan error WAHA yang polanya sudah dikenal menjadi instruksi yang bisa
 * ditindaklanjuti admin — pesan mentah engine berbahasa Inggris dan tidak
 * menyebut apa yang harus diubah. MURNI supaya bisa diuji. Null = tak dikenal.
 */
export function terjemahkanWahaError(status: number, body: string): string | null {
  const b = body.toLowerCase();
  if (status === 401 || status === 403) {
    return "WAHA menolak API key (401/403) — periksa API key di halaman Sistem.";
  }
  // Engine NOWEB menolak /groups bila store dimatikan (setelan default-nya mati).
  if (b.includes("store") && (b.includes("enabled") || b.includes("noweb"))) {
    return (
      "Engine NOWEB di server WAHA belum mengaktifkan STORE, jadi daftar grup tidak bisa dibaca. " +
      "Set env WAHA: WAHA_NOWEB_STORE_ENABLED=true dan WAHA_NOWEB_STORE_FULLSYNC=true, restart WAHA, " +
      "lalu logout & scan QR ulang. Sementara itu pakai Cara 2 (link undangan grup) — tidak butuh store."
    );
  }
  if (status === 404 && (b.includes("session") || b.includes("not found"))) {
    return (
      "WAHA tidak mengenal sesi ini (404) — periksa NAMA SESI di halaman Sistem " +
      '(bawaan WAHA biasanya "default", huruf kecil semua, harus persis sama).'
    );
  }
  if (status === 422) {
    return `WAHA menolak permintaan (422): ${body.slice(0, 200)}. Biasanya sesi belum login — cek status sesi di halaman Sistem.`;
  }
  return null;
}

/** Timeout default panggilan WAHA. Kirim file & tarik grup diberi jatah lebih besar. */
const WAHA_TIMEOUT_MS = 20_000;

async function wahaFetch(
  c: ResolvedCfg,
  path: string,
  init?: RequestInit,
  timeoutMs: number = WAHA_TIMEOUT_MS,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${c.baseUrl}${path}`, {
      ...init,
      headers: {
        "X-Api-Key": c.apiKey,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      // Server-to-server; jangan cache. Tanpa timeout, WAHA yang menggantung
      // membuat tombol berputar selamanya sampai gateway memutus tanpa pesan.
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timeout = err instanceof Error && err.name === "TimeoutError";
    throw new WahaError(
      timeout
        ? `Server WAHA tidak merespons dalam ${Math.round(timeoutMs / 1000)} detik (${c.baseUrl}) — cek apakah servernya hidup & tidak kelebihan beban.`
        : `Tidak bisa menghubungi server WAHA (${c.baseUrl}): ${err instanceof Error ? err.message : "gagal koneksi"}. ` +
          "Bila WAHA di Railway yang sama, pakai URL private networking dengan http:// (bukan https://), mis. http://waha.railway.internal:3000.",
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* abaikan */
    }
    const dikenal = terjemahkanWahaError(res.status, detail);
    if (dikenal) throw new WahaError(dikenal, res.status);
    throw new WahaError(`WAHA error ${res.status}: ${detail.slice(0, 300) || res.statusText}`, res.status);
  }
  return res;
}

export type WahaSessionStatus = {
  name: string;
  status: string; // STARTING | SCAN_QR_CODE | WORKING | FAILED | STOPPED
  /**
   * Identitas sesi. `lid` = identitas privasi WhatsApp untuk nomor yang sama
   * (DECISIONS 349) — nama medannya berbeda antar versi WAHA, jadi dibaca
   * defensif seperti medan payload lain.
   */
  me?: { id?: string; pushName?: string; lid?: string; lidId?: string } | null;
};

/** Status sesi WA (login/belum). */
export async function getSessionStatus(): Promise<WahaSessionStatus> {
  const c = await cfg();
  const res = await wahaFetch(c, `/api/sessions/${encodeURIComponent(c.session)}`);
  const data = (await res.json()) as WahaSessionStatus;
  return data;
}

/**
 * Nomor WhatsApp MARLIN SENDIRI, dari `me.id` sesi WAHA (mis. "628…@c.us").
 *
 * Dipakai memutuskan apakah MARLIN di-mention di grup (DECISIONS 338/339).
 * Bukan medan konfigurasi: nomornya adalah nomor perangkat yang sedang login,
 * dan menyalinnya ke pengaturan hanya menciptakan sumber kedua yang bisa basi
 * begitu sesi dipindah ke nomor lain.
 *
 * Di-cache di memori proses (10 menit): tanpa itu, SETIAP pesan grup masuk
 * memicu satu panggilan HTTP ke WAHA hanya untuk menanyakan nomor yang tidak
 * berubah. Kegagalan mengembalikan null — dan null berarti grup TIDAK dilayani,
 * bukan dilayani tanpa syarat.
 */
let cacheNomor: { nilai: IdentitasSesi; sampai: number } | null = null;

/**
 * Identitas MARLIN sendiri — nomor DAN LID (DECISIONS 349).
 *
 * Sejak WhatsApp memakai identitas privasi, penyebutan di grup bisa berisi
 * `…@lid` alih-alih JID bernomor. Mengenali diri sendiri lewat nomor saja
 * membuat SETIAP mention di grup terbaca "tidak ada mention".
 */
export type IdentitasSesi = { nomor: string | null; lid: string | null };

export async function getIdentitasMarlin(): Promise<IdentitasSesi> {
  if (cacheNomor && Date.now() < cacheNomor.sampai) return cacheNomor.nilai;
  let nilai: IdentitasSesi = { nomor: null, lid: null };
  try {
    const s = await getSessionStatus();
    // Hanya sesi yang benar-benar login yang punya identitas; sesi SCAN_QR_CODE
    // bisa membawa `me` sisa sesi sebelumnya.
    if (s.status === "WORKING") {
      const me = (s.me ?? {}) as Record<string, unknown>;
      const teks = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      const id = teks(me.id);
      // `me.id` sendiri bisa berupa @lid pada sesi yang sudah bermigrasi.
      const idLid = id && /@lid$/i.test(id) ? id : null;
      nilai = {
        nomor: idLid ? null : (id?.replace(/@.*$/, "") ?? null),
        lid: (idLid ?? teks(me.lid) ?? teks(me.lidId))?.replace(/@.*$/, "") ?? null,
      };
    }
  } catch {
    // WAHA mati / belum dikonfigurasi → identitas tidak diketahui. Jangan
    // melempar: pemanggilnya sedang memproses webhook masuk.
    nilai = { nomor: null, lid: null };
  }
  // Kegagalan di-cache lebih singkat supaya sesi yang baru login cepat terbaca.
  const tahu = !!(nilai.nomor || nilai.lid);
  cacheNomor = { nilai, sampai: Date.now() + (tahu ? 600_000 : 60_000) };
  return nilai;
}

/*
 * SENGAJA tidak ada `getNomorMarlin()` lagi (DECISIONS 349). Pembantu "nomor
 * saja" itu persis jebakan yang menyebabkan cacat ini: memanggilnya terasa
 * benar, dan hasilnya MARLIN tidak mengenali dirinya sendiri di grup yang sudah
 * bermigrasi ke identitas privasi. Identitas WhatsApp ada DUA — ambil keduanya.
 */

/** Buang cache identitas (dipakai uji & saat sesi WAHA diganti). */
export function lupakanNomorMarlin(): void {
  cacheNomor = null;
}

export type WahaGroup = { id: string; name: string };

/** Ekstrak id grup ("…@g.us") dari bentuk string atau objek { _serialized } / { user, server }. */
function extractGroupId(idRaw: unknown): string {
  if (typeof idRaw === "string") return idRaw;
  const rec = idRaw as Record<string, unknown> | null;
  if (!rec) return "";
  if (typeof rec._serialized === "string") return rec._serialized;
  if (typeof rec.user === "string" && typeof rec.server === "string") return `${rec.user}@${rec.server}`;
  return "";
}

function extractGroupName(rec: Record<string, unknown>, fallback: string): string {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  return (
    str(rec.name) ??
    str(rec.subject) ??
    str(rec.Name) ?? // engine GOWS
    str(rec.GroupName) ??
    str(rec.title) ??
    str((rec.groupMetadata as Record<string, unknown> | undefined)?.subject) ??
    fallback
  );
}

/** ID grup dari berbagai varian key lintas engine WAHA (id/JID/jid/chatId). */
function extractGroupIdMulti(rec: Record<string, unknown>): string {
  for (const key of ["id", "JID", "jid", "chatId", "chat_id", "_serialized"]) {
    const id = extractGroupId(rec[key]);
    if (id) return id;
  }
  return "";
}

/**
 * Ambil array grup dari respons WAHA. Beberapa versi/engine mengembalikan array
 * polos; yang lain membungkus dalam { data | groups | items | results | chats }.
 */
function unwrapArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    for (const k of ["data", "groups", "items", "results", "chats"]) {
      if (Array.isArray(rec[k])) return rec[k] as unknown[];
    }
    // Peta objek ber-key JID ("1203…@g.us": {...}) — bentuk store NOWEB lama.
    const keys = Object.keys(rec);
    if (keys.length > 0 && keys.every((k) => k.includes("@"))) {
      return keys.map((k) => {
        const v = rec[k];
        return v && typeof v === "object" ? { id: k, ...(v as object) } : { id: k };
      });
    }
  }
  return [];
}

/** Parser respons /groups lintas engine — MURNI supaya bisa diuji tanpa server. */
export function parseGroupsResponse(data: unknown): WahaGroup[] {
  return unwrapArray(data)
    .map((g) => {
      const rec = (g && typeof g === "object" ? g : {}) as Record<string, unknown>;
      const id = extractGroupIdMulti(rec);
      return { id, name: extractGroupName(rec, id) };
    })
    .filter((g) => g.id.endsWith("@g.us"));
}

/** Daftar grup WA yang bisa dikirimi (butuh sesi WORKING + store aktif utk NOWEB). */
export async function listGroups(): Promise<WahaGroup[]> {
  const c = await cfg();
  // Akun dengan ratusan chat butuh waktu — jangan pakai timeout default 20 dtk.
  const res = await wahaFetch(c, `/api/${encodeURIComponent(c.session)}/groups`, undefined, 60_000);
  const data = (await res.json()) as unknown;
  return parseGroupsResponse(data);
}

/**
 * Info satu grup by ID — untuk VERIFIKASI saat admin menyimpan ID grup manual:
 * memastikan ID benar & nomor pengirim memang anggota, plus mengambil nama
 * grup yang sebenarnya. Return null = grup tidak ditemukan di akun ini.
 */
export async function getGroupInfo(groupId: string): Promise<WahaGroup | null> {
  const c = await cfg();
  const id = normalizeGroupChatId(groupId);
  let res: Response;
  try {
    res = await wahaFetch(c, `/api/${encodeURIComponent(c.session)}/groups/${encodeURIComponent(id)}`);
  } catch (err) {
    // 404 dari endpoint ini berarti "grup tidak ada di akun", bukan konfigurasi salah.
    if (err instanceof WahaError && /404/.test(err.message)) return null;
    throw err;
  }
  const data = (await res.json()) as unknown;
  const rec = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const foundId = extractGroupIdMulti(rec) || id;
  const name = extractGroupName(rec, "");
  if (!name && !extractGroupIdMulti(rec)) return null; // respons kosong/tak dikenal
  return { id: foundId, name: name || foundId };
}

/** Ambil kode undangan dari link chat.whatsapp.com/XXXX (atau kode polos). */
export function parseInviteCode(raw: string): string {
  const t = raw.trim();
  const m = t.match(/(?:chat\.whatsapp\.com\/)([A-Za-z0-9_-]{6,})/i);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{6,}$/.test(t)) return t;
  throw new WahaError("Link undangan tidak valid. Tempel link seperti https://chat.whatsapp.com/XXXXXXXX");
}

/**
 * Resolusi ID grup dari LINK UNDANGAN (chat.whatsapp.com/XXXX) via WAHA —
 * TANPA perlu store NOWEB. Coba join-info (tak bergabung) dulu; bila engine
 * tak dukung, fallback ke join (idempotent bila nomor sudah anggota).
 */
export async function resolveGroupByInvite(rawLink: string): Promise<WahaGroup> {
  const c = await cfg();
  const code = parseInviteCode(rawLink);
  const session = encodeURIComponent(c.session);

  // 1) join-info: ambil metadata grup tanpa bergabung.
  try {
    const res = await wahaFetch(c, `/api/${session}/groups/join-info?code=${encodeURIComponent(code)}`);
    const data = (await res.json()) as Record<string, unknown>;
    const id = extractGroupId(data.id ?? data);
    if (id.endsWith("@g.us")) return { id, name: extractGroupName(data, id) };
  } catch {
    /* engine tak dukung join-info → fallback join */
  }

  // 2) join: bergabung (aman bila sudah anggota) → kembalikan id grup.
  const res = await wahaFetch(c, `/api/${session}/groups/join`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  const data = (await res.json()) as unknown;
  const rec = (typeof data === "object" && data ? data : {}) as Record<string, unknown>;
  const id = extractGroupId(rec.id ?? data);
  if (!id.endsWith("@g.us")) {
    throw new WahaError("Tidak bisa mengambil ID grup dari link ini. Pastikan link undangan benar & masih aktif.");
  }
  return { id, name: extractGroupName(rec, id) };
}

export type FilePayload = { mimetype: string; filename: string; data: string }; // data = base64

/**
 * TRANSPORT MENTAH — hanya bicara HTTP ke WAHA (DECISIONS 374).
 *
 * Ketiga fungsi `kirimMentah*` di bawah TIDAK memeriksa sesi, TIDAK mencatat
 * apa pun, dan TIDAK memutuskan apakah pesannya "terkirim". Semua itu tugas
 * `gateway.ts`, dan menaruhnya di sini berarti punya dua tempat yang harus
 * setuju. Jangan panggil langsung dari fitur — pakai `sendWaMessage()`.
 *
 * Ketiganya kini mengembalikan ID pesan. Dulu hanya `sendText` yang melakukannya;
 * `sendImage`/`sendFile` mengembalikan `void`, sehingga kiriman laporan resmi —
 * justru yang paling penting dilacak — tidak pernah punya bukti apa pun bahwa
 * WAHA menerimanya.
 */
export async function kirimMentahTeks(chatId: string, text: string): Promise<string | null> {
  const c = await cfg();
  const res = await wahaFetch(c, `/api/sendText`, {
    method: "POST",
    body: JSON.stringify({ session: c.session, chatId, text }),
  });
  try {
    const data = (await res.json()) as unknown;
    return extractMessageId(data);
  } catch {
    // Beberapa versi WAHA membalas tanpa body. Bukan kegagalan kirim, tapi
    // juga bukan bukti — jangan mengarang id.
    return null;
  }
}

/** ID pesan dari respons sendText, lintas bentuk versi/engine WAHA. */
export function extractMessageId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  const id = rec.id ?? (rec.key as Record<string, unknown> | undefined)?.id ?? rec._id;
  if (typeof id === "string" && id) return id;
  if (id && typeof id === "object") {
    const ser = (id as Record<string, unknown>)._serialized;
    if (typeof ser === "string" && ser) return ser;
  }
  return null;
}

async function kirimMentahBerkas(
  jalur: "sendImage" | "sendFile",
  chatId: string,
  file: FilePayload,
  caption?: string,
): Promise<string | null> {
  const c = await cfg();
  const res = await wahaFetch(
    c,
    `/api/${jalur}`,
    { method: "POST", body: JSON.stringify({ session: c.session, chatId, file, caption: caption || undefined }) },
    120_000,
  );
  try {
    return extractMessageId((await res.json()) as unknown);
  } catch {
    // Sebagian versi WAHA membalas tanpa body. Bukan kegagalan kirim, tapi juga
    // bukan bukti — jangan mengarang id.
    return null;
  }
}

export function kirimMentahGambar(chatId: string, file: FilePayload, caption?: string) {
  return kirimMentahBerkas("sendImage", chatId, file, caption);
}

export function kirimMentahFile(chatId: string, file: FilePayload, caption?: string) {
  return kirimMentahBerkas("sendFile", chatId, file, caption);
}

/** Ubah buffer → payload file base64 WAHA. */
export function toFilePayload(buffer: Buffer, mimetype: string, filename: string): FilePayload {
  return { mimetype, filename, data: buffer.toString("base64") };
}
