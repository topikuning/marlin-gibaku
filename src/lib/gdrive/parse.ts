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

/** Host yang BUKAN alamat publik — alamat bind container / jaringan internal. */
function isBindAddress(host: string): boolean {
  const bare = host.replace(/:\d+$/, "").toLowerCase();
  return (
    bare === "0.0.0.0" ||
    bare === "::" ||
    bare === "[::]" ||
    bare === "" ||
    bare.endsWith(".railway.internal")
  );
}

function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
}

/** Ambil host dari nilai yang mungkin berupa URL penuh atau host polos. */
function hostOf(value: string): string {
  const v = value.trim().replace(/\/+$/, "");
  if (!v) return "";
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).host;
  } catch {
    return "";
  }
}

export type OriginSources = {
  /** Override eksplisit operator (APP_PUBLIC_URL) — prioritas tertinggi. */
  envUrl?: string | null;
  /** RAILWAY_PUBLIC_DOMAIN — disediakan Railway otomatis. */
  railwayDomain?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
};

/**
 * Origin publik untuk redirect URI OAuth. Dua jebakan nyata yang ditangani:
 * (1) di balik proxy request internal berskema http, sedangkan Google MENOLAK
 * redirect URI http untuk domain publik; (2) header `host` bisa berisi alamat
 * bind container (`0.0.0.0:8080`) sehingga URI-nya tidak berarti. Karena itu
 * env eksplisit didahulukan dan alamat bind ditolak. MURNI.
 */
export function publicOrigin(src: OriginSources): string | null {
  for (const raw of [src.envUrl, src.railwayDomain]) {
    const h = hostOf(raw ?? "");
    if (h && !isBindAddress(h)) return isLocalHost(h) ? `http://${h}` : `https://${h}`;
  }
  for (const raw of [src.forwardedHost, src.host]) {
    const h = (raw ?? "").split(",")[0].trim();
    if (!h || isBindAddress(h)) continue;
    if (isLocalHost(h)) return `${(src.forwardedProto ?? "http").split(",")[0].trim()}://${h}`;
    return `https://${h}`;
  }
  return null;
}

/** Redirect URI lengkap — satu-satunya sumber, dipakai kedua route & ditampilkan di UI. */
export function driveRedirectUri(src: OriginSources): string | null {
  const origin = publicOrigin(src);
  return origin ? `${origin}${GDRIVE_REDIRECT_PATH}` : null;
}

export type GDriveUploadKind =
  | "laporan_harian"
  | "laporan_mingguan"
  | "laporan_bulanan"
  | "kegiatan"
  | "dokumen";

export const GDRIVE_KIND_LABEL: Record<GDriveUploadKind, string> = {
  laporan_harian: "Laporan harian",
  laporan_mingguan: "Laporan mingguan",
  laporan_bulanan: "Laporan bulanan",
  kegiatan: "Kegiatan lapangan",
  dokumen: "Dokumen administrasi",
};

/* ── Hasil upload ───────────────────────────────────────────────────────── */

export type UploadOutcome = {
  ok: number;
  failed: number;
  /** Berapa yang MEMPERBARUI file lama (revisi baru), bukan file baru. */
  updated: number;
  /** Pesan error pertama — ditampilkan ke user. */
  firstError: string | null;
  /**
   * Status HTTP di balik `firstError`, bila galatnya datang dari Drive. Antrean
   * otomatis memakainya untuk membedakan tertahan laju vs salah beneran
   * (DECISIONS 313); banner di layar tidak memakainya.
   */
  firstErrorStatus?: number | null;
  /** Header `Retry-After` yang menyertai galat itu, bila ada. */
  firstRetryAfter?: string | null;
  webLink: string | null;
};

/**
 * Rangkum hasil upload jadi kalimat Indonesia untuk banner aksi. Membedakan
 * file BARU dan file DIPERBARUI itu penting: yang diperbarui tidak menghapus
 * apa pun — isi lama tersimpan sebagai versi sebelumnya di Drive. MURNI.
 * DECISIONS 146.
 */
export function summarize(label: string, outcomes: UploadOutcome[], skippedPhotos = 0): string {
  const ok = outcomes.reduce((s, o) => s + o.ok, 0);
  const failed = outcomes.reduce((s, o) => s + o.failed, 0);
  const updated = outcomes.reduce((s, o) => s + o.updated, 0);
  const baru = ok - updated;
  const parts: string[] = [];
  if (baru > 0) parts.push(`${baru} file baru`);
  if (updated > 0) parts.push(`${updated} file diperbarui (versi baru di Drive)`);
  if (parts.length === 0) parts.push("tidak ada file");
  if (failed > 0) parts.push(`${failed} gagal`);
  if (skippedPhotos > 0) parts.push(`${skippedPhotos} foto tak terbaca dari penyimpanan`);
  return `${label}: ${parts.join(", ")}.`;
}
