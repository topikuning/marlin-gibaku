import "server-only";
import { getWahaConfig } from "@/lib/waha/config";

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

export class WahaError extends Error {}

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

/** Format chatId grup: pastikan berakhiran @g.us (terima id polos atau lengkap). */
export function normalizeGroupChatId(raw: string): string {
  const t = raw.trim();
  if (!t) throw new WahaError("ID grup kosong.");
  if (t.endsWith("@g.us")) return t;
  if (t.endsWith("@c.us")) return t; // kontak personal (dibolehkan, walau utama grup)
  // hanya angka (+ mungkin '-') → anggap id grup
  if (/^[0-9-]+$/.test(t)) return `${t}@g.us`;
  throw new WahaError(`Format ID grup tidak dikenal: ${raw} (harusnya seperti 12036300000000@g.us)`);
}

type ResolvedCfg = { baseUrl: string; apiKey: string; session: string };

async function wahaFetch(c: ResolvedCfg, path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${c.baseUrl}${path}`, {
      ...init,
      headers: {
        "X-Api-Key": c.apiKey,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      // Server-to-server; jangan cache.
      cache: "no-store",
    });
  } catch (err) {
    throw new WahaError(
      `Tidak bisa menghubungi server WAHA (${c.baseUrl}): ${err instanceof Error ? err.message : "gagal koneksi"}`,
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* abaikan */
    }
    if (res.status === 401 || res.status === 403) {
      throw new WahaError("WAHA menolak API key (401/403) — periksa API key di halaman Sistem.");
    }
    throw new WahaError(`WAHA error ${res.status}: ${detail.slice(0, 300) || res.statusText}`);
  }
  return res;
}

export type WahaSessionStatus = {
  name: string;
  status: string; // STARTING | SCAN_QR_CODE | WORKING | FAILED | STOPPED
  me?: { id?: string; pushName?: string } | null;
};

/** Status sesi WA (login/belum). */
export async function getSessionStatus(): Promise<WahaSessionStatus> {
  const c = await cfg();
  const res = await wahaFetch(c, `/api/sessions/${encodeURIComponent(c.session)}`);
  const data = (await res.json()) as WahaSessionStatus;
  return data;
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
  return (
    (rec.name as string | undefined) ??
    (rec.subject as string | undefined) ??
    ((rec.groupMetadata as Record<string, unknown> | undefined)?.subject as string | undefined) ??
    fallback
  );
}

/** Daftar grup WA yang bisa dikirimi (butuh sesi WORKING + store aktif utk NOWEB). */
export async function listGroups(): Promise<WahaGroup[]> {
  const c = await cfg();
  const res = await wahaFetch(c, `/api/${encodeURIComponent(c.session)}/groups`);
  const data = (await res.json()) as unknown;
  const arr = Array.isArray(data) ? data : [];
  return arr
    .map((g) => {
      const rec = g as Record<string, unknown>;
      const id = extractGroupId(rec.id);
      return { id, name: extractGroupName(rec, id) };
    })
    .filter((g) => g.id.endsWith("@g.us"));
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

type FilePayload = { mimetype: string; filename: string; data: string }; // data = base64

export async function sendText(chatId: string, text: string): Promise<void> {
  const c = await cfg();
  await wahaFetch(c, `/api/sendText`, {
    method: "POST",
    body: JSON.stringify({ session: c.session, chatId, text }),
  });
}

export async function sendImage(chatId: string, file: FilePayload, caption?: string): Promise<void> {
  const c = await cfg();
  await wahaFetch(c, `/api/sendImage`, {
    method: "POST",
    body: JSON.stringify({ session: c.session, chatId, file, caption: caption || undefined }),
  });
}

export async function sendFile(chatId: string, file: FilePayload, caption?: string): Promise<void> {
  const c = await cfg();
  await wahaFetch(c, `/api/sendFile`, {
    method: "POST",
    body: JSON.stringify({ session: c.session, chatId, file, caption: caption || undefined }),
  });
}

/** Ubah buffer → payload file base64 WAHA. */
export function toFilePayload(buffer: Buffer, mimetype: string, filename: string): FilePayload {
  return { mimetype, filename, data: buffer.toString("base64") };
}
