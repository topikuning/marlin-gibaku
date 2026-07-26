/**
 * Util MURNI integrasi Google Drive (tanpa DB/network) — bisa diuji unit.
 * DECISIONS 141.
 */

/**
 * Ambil ID folder dari input bebas: ID mentah atau URL Drive
 * (`.../drive/folders/<id>`, `.../drive/u/0/folders/<id>`, `...?id=<id>`).
 * Null bila tidak dikenali — jangan menebak.
 */
export function parseDriveFolderId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // ID mentah: huruf/angka/-/_ (ID Drive nyata ≥ ~25 char; batas bawah longgar).
  if (/^[A-Za-z0-9_-]{15,}$/.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) return null;
  const m = url.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  const qid = url.searchParams.get("id");
  if (qid && /^[A-Za-z0-9_-]{10,}$/.test(qid)) return qid;
  return null;
}

/**
 * Susun body `multipart/related` untuk upload Drive v3 (metadata JSON + isi
 * file). Mengembalikan buffer body + header Content-Type ber-boundary.
 */
export function buildMultipartBody(
  metadata: Record<string, unknown>,
  mime: string,
  data: Buffer,
  boundary = "marlin-gdrive-boundary",
): { body: Buffer; contentType: string } {
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mime}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    body: Buffer.concat([Buffer.from(head, "utf8"), data, Buffer.from(tail, "utf8")]),
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

/** Path callback OAuth — HARUS identik di /auth, /callback, dan Google Console. */
export const GDRIVE_REDIRECT_PATH = "/api/gdrive/callback";

/**
 * Origin publik untuk redirect URI OAuth. Di belakang proxy (Railway) request
 * internal berskema http, sedangkan Google MENOLAK redirect URI http untuk
 * domain publik ("doesn't comply with Google's OAuth 2.0 policy", error 400
 * invalid_request) — jadi paksa https kecuali host lokal. MURNI.
 */
export function publicOrigin(
  forwardedHost: string | null,
  host: string | null,
  forwardedProto: string | null,
): string | null {
  const h = (forwardedHost ?? host ?? "").split(",")[0].trim();
  if (!h) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h);
  if (local) return `${(forwardedProto ?? "http").split(",")[0].trim()}://${h}`;
  return `https://${h}`;
}

/** Redirect URI lengkap — satu-satunya sumber, dipakai kedua route & ditampilkan di UI. */
export function driveRedirectUri(
  forwardedHost: string | null,
  host: string | null,
  forwardedProto: string | null,
): string | null {
  const origin = publicOrigin(forwardedHost, host, forwardedProto);
  return origin ? `${origin}${GDRIVE_REDIRECT_PATH}` : null;
}

export type GDriveUploadKind = "laporan_harian" | "laporan_mingguan" | "laporan_bulanan";

export const GDRIVE_KIND_LABEL: Record<GDriveUploadKind, string> = {
  laporan_harian: "Laporan harian",
  laporan_mingguan: "Laporan mingguan",
  laporan_bulanan: "Laporan bulanan",
};
