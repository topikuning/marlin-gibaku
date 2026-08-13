import "server-only";
import { getGDriveAuth } from "./config";
import { buildMultipartBody } from "./parse";

/**
 * Klien Google Drive v3 via fetch murni (tanpa SDK googleapis — hemat bundle).
 * Auth: OAuth refresh token akun Gmail editor folder KKP. Selalu
 * `supportsAllDrives=true` agar folder Shared Drive maupun My Drive sama-sama
 * jalan. DECISIONS 141.
 */

/**
 * Galat Drive. `status` & `retryAfter` DIBAWA SERTA (bukan cuma pesan) karena
 * antrean unggah otomatis harus bisa membedakan "Google menyuruh pelan-pelan"
 * dari "folder tidak ada" — dua hal yang penanganannya berlawanan (DECISIONS
 * 312). Menebaknya dari teks pesan rapuh; status HTTP-nya tidak.
 */
export class GDriveError extends Error {
  readonly status: number | null;
  readonly retryAfter: string | null;

  constructor(message: string, opts?: { status?: number | null; retryAfter?: string | null }) {
    super(message);
    this.status = opts?.status ?? null;
    this.retryAfter = opts?.retryAfter ?? null;
  }
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink";

/**
 * Penanda "berkas ini TERBITAN MARLIN" di Drive. `appProperties` bersifat
 * privat per-aplikasi (tidak terlihat pengguna, tidak mengotori UI Drive) dan
 * ikut terbawa walau file diganti nama atau dipindah folder.
 *
 * Gunanya: memutus lingkaran laporan (DECISIONS 191). MARLIN mengunggah PDF
 * laporan ke folder KKP, lalu impor Drive membaca folder yang sama dan
 * menawarkan berkas itu lagi sebagai "dokumen baru" — padahal ia terbitan
 * MARLIN sendiri dan datanya sudah ada.
 */
export const MARLIN_APP_PROPERTY = "marlinTerbitan";
const MARLIN_APP_PROPERTIES = { [MARLIN_APP_PROPERTY]: "1" };

// Cache access token per proses (habis ~1 jam; refresh 60 dtk lebih awal).
let cached: { token: string; expiresAt: number } | null = null;

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: { message?: string }; error_description?: string };
    return j.error?.message ?? j.error_description ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200) || `HTTP ${res.status}`;
  }
}

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const auth = await getGDriveAuth();
  if (!auth) throw new GDriveError("Client ID/secret Google belum diisi (Sistem → Integrasi → Google Drive).");
  if (!auth.refreshToken)
    throw new GDriveError("Akun Google belum terhubung — klik “Hubungkan akun Google” di Sistem.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      refresh_token: auth.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const msg = await readError(res);
    // invalid_grant = token dicabut/kedaluwarsa (mis. app masih status Testing).
    throw new GDriveError(
      msg.includes("invalid_grant")
        ? "Token Google kedaluwarsa/dicabut — hubungkan ulang akun di Sistem. (Pastikan OAuth app berstatus In production, bukan Testing.)"
        : `Gagal menyegarkan token Google: ${msg}`,
    );
  }
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: j.access_token, expiresAt: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
  return j.access_token;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Cari folder bernama `name` di dalam `parentId`; buat bila belum ada.
 * Pencarian didahulukan supaya folder yang SUDAH dibuat KKP (beserta isinya)
 * dipakai apa adanya, bukan diduplikasi. Cache per proses menekan panggilan
 * berulang saat mengupload banyak file ke folder yang sama. DECISIONS 143.
 */
const folderCache = new Map<string, string>();

/** Nama di query Drive dikutip tunggal — escape backslash & kutipnya. */
function escapeQ(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function ensureFolder(parentId: string, name: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  const hit = folderCache.get(cacheKey);
  if (hit) return hit;

  const token = await getAccessToken();
  const escaped = escapeQ(name);
  const q = `name = '${escaped}' and mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed = false`;
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&fields=files(id,name)&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new GDriveError(`Gagal mencari folder "${name}": ${await readError(res)}`);
  const found = ((await res.json()) as { files?: { id: string }[] }).files ?? [];
  if (found[0]?.id) {
    folderCache.set(cacheKey, found[0].id);
    return found[0].id;
  }

  const create = await fetch(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!create.ok) throw new GDriveError(`Gagal membuat folder "${name}": ${await readError(create)}`);
  const id = ((await create.json()) as { id: string }).id;
  folderCache.set(cacheKey, id);
  return id;
}

/** Telusuri/buat berjenjang; mengembalikan ID folder terdalam. */
export async function ensureFolderPath(rootId: string, segments: string[]): Promise<string> {
  let parent = rootId;
  for (const seg of segments.slice(0, 8)) parent = await ensureFolder(parent, seg);
  return parent;
}

export type DriveFile = {
  id: string;
  name: string;
  webViewLink: string | null;
  /** false = file lama diperbarui (revisi baru), bukan file baru dibuat. */
  created: boolean;
};

/** Cari file bernama `name` di dalam folder (yang tidak di sampah). */
async function findFileInFolder(folderId: string, name: string): Promise<string | null> {
  const token = await getAccessToken();
  const q = `name = '${escapeQ(name)}' and '${folderId}' in parents and trashed = false`;
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&fields=files(id)&pageSize=2&supportsAllDrives=true&includeItemsFromAllDrives=true` +
    `&orderBy=createdTime`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new GDriveError(`Gagal mencari file "${name}": ${await readError(res)}`);
  const files = ((await res.json()) as { files?: { id: string }[] }).files ?? [];
  return files[0]?.id ?? null;
}

/**
 * Upload satu file ke folder — MEMPERBARUI bila nama yang sama sudah ada.
 * Drive membolehkan nama ganda dalam satu folder, jadi tanpa pencarian ini
 * upload ulang akan menumpuk file kembar. Dengan PATCH ke fileId yang sama,
 * Drive menyimpan isi baru sebagai REVISI: versi lama tetap bisa dibuka lewat
 * "Kelola versi" dan tautan yang sudah dibagikan tidak berubah.
 * `keepRevisionForever` menjaga revisi lama tidak dipangkas otomatis —
 * laporan resmi ke KKP harus bisa ditelusuri. DECISIONS 146.
 */
export async function uploadToDrive(input: {
  folderId: string;
  fileName: string;
  mime: string;
  data: Buffer;
}): Promise<DriveFile> {
  const token = await getAccessToken();
  const existingId = await findFileInFolder(input.folderId, input.fileName);

  // Saat memperbarui: JANGAN kirim `parents` (Drive menolak perubahan induk
  // lewat body; pemindahan folder butuh addParents/removeParents).
  const { body, contentType } = buildMultipartBody(
    existingId
      ? { name: input.fileName, appProperties: MARLIN_APP_PROPERTIES }
      : {
          name: input.fileName,
          parents: [input.folderId],
          appProperties: MARLIN_APP_PROPERTIES,
        },
    input.mime,
    input.data,
  );
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}` +
      `?uploadType=multipart&supportsAllDrives=true&keepRevisionForever=true&fields=id,name,webViewLink`
    : UPLOAD_URL;

  const res = await fetch(url, {
    method: existingId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const msg = await readError(res);
    throw new GDriveError(
      res.status === 404
        ? "Folder Drive tidak ditemukan / akun tidak punya akses. Cek ID folder di paket & hak editor akun."
        : `${existingId ? "Memperbarui" : "Upload"} file di Drive gagal: ${msg}`,
      { status: res.status, retryAfter: res.headers.get("retry-after") },
    );
  }
  const j = (await res.json()) as { id: string; name: string; webViewLink?: string };
  return { id: j.id, name: j.name, webViewLink: j.webViewLink ?? null, created: !existingId };
}

/** Validasi akses folder (dipakai saat menyimpan ID folder di paket). */
export async function probeDriveFolder(folderId: string): Promise<{ name: string }> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) {
    throw new GDriveError(
      res.status === 404
        ? "Folder tidak ditemukan atau akun Google MARLIN belum diberi akses editor ke folder ini."
        : `Gagal membaca folder: ${await readError(res)}`,
    );
  }
  const j = (await res.json()) as { name: string; mimeType?: string };
  if (j.mimeType !== "application/vnd.google-apps.folder")
    throw new GDriveError("ID tersebut bukan folder Drive.");
  return { name: j.name };
}

/** Identitas akun terhubung (untuk tombol Tes di Sistem). */
export async function driveAbout(): Promise<{ email: string | null; name: string | null }> {
  const token = await getAccessToken();
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new GDriveError(`Gagal membaca info akun: ${await readError(res)}`);
  const j = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
  return { email: j.user?.emailAddress ?? null, name: j.user?.displayName ?? null };
}

/* ── Membaca isi folder (impor dari Drive KKP) ───────────────────────────── */

export type DriveEntry = {
  id: string;
  name: string;
  mimeType: string;
  /** Ukuran byte; null untuk dokumen native Google (harus diekspor dulu). */
  size: number | null;
  modifiedTime: Date | null;
  webViewLink: string | null;
  /** Jalur folder relatif dari akar paket, mis. ["2. PCM", "Kedungrejo"]. */
  path: string[];
  /** true = berkas ini diunggah MARLIN sendiri (lihat MARLIN_APP_PROPERTY). */
  terbitanMarlin: boolean;
};

const LIST_FIELDS =
  "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,appProperties)";

/** Satu halaman anak folder (file + subfolder). */
async function listChildren(folderId: string, pageToken?: string) {
  const token = await getAccessToken();
  const q = `'${folderId}' in parents and trashed = false`;
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&fields=${encodeURIComponent(LIST_FIELDS)}&pageSize=200&supportsAllDrives=true` +
    `&includeItemsFromAllDrives=true&orderBy=folder,name` +
    (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new GDriveError(`Gagal membaca isi folder: ${await readError(res)}`);
  return (await res.json()) as {
    nextPageToken?: string;
    files?: {
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
      appProperties?: Record<string, string>;
    }[];
  };
}

/**
 * Telusuri folder Drive secara berjenjang (BFS) dan kembalikan FILE-nya saja.
 * Batas kedalaman & jumlah dipasang keras: folder KKP dibuat manusia dan bisa
 * memuat apa saja (termasuk folder foto beribu berkas) — impor tidak boleh
 * menggantung tanpa batas. Pemanggil diberi tahu bila batas tercapai supaya
 * angka "ditemukan N file" tidak berbohong.
 */
export async function walkDriveFolder(
  rootId: string,
  opts: { maxDepth?: number; maxFiles?: number } = {},
): Promise<{ files: DriveEntry[]; truncated: boolean }> {
  const maxDepth = opts.maxDepth ?? 4;
  const maxFiles = opts.maxFiles ?? 500;
  const files: DriveEntry[] = [];
  let truncated = false;

  let frontier: { id: string; path: string[] }[] = [{ id: rootId, path: [] }];
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: { id: string; path: string[] }[] = [];
    for (const folder of frontier) {
      let pageToken: string | undefined;
      do {
        const page = await listChildren(folder.id, pageToken);
        for (const f of page.files ?? []) {
          if (f.mimeType === FOLDER_MIME) {
            if (depth < maxDepth) next.push({ id: f.id, path: [...folder.path, f.name] });
            else truncated = true;
            continue;
          }
          if (files.length >= maxFiles) {
            truncated = true;
            continue;
          }
          files.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size ? Number(f.size) : null,
            modifiedTime: f.modifiedTime ? new Date(f.modifiedTime) : null,
            webViewLink: f.webViewLink ?? null,
            path: folder.path,
            terbitanMarlin: f.appProperties?.[MARLIN_APP_PROPERTY] === "1",
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    frontier = next;
  }
  return { files, truncated };
}

/** Metadata satu file — dibaca ulang saat commit impor (jangan percaya klien). */
export async function driveFileMeta(fileId: string): Promise<DriveEntry> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
      `?supportsAllDrives=true&fields=id,name,mimeType,size,modifiedTime,webViewLink,appProperties`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) {
    throw new GDriveError(
      res.status === 404
        ? "File tidak ditemukan di Drive (mungkin dipindah/dihapus setelah pratinjau dibuat)."
        : `Gagal membaca file Drive: ${await readError(res)}`,
    );
  }
  const j = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
    appProperties?: Record<string, string>;
  };
  return {
    id: j.id,
    name: j.name,
    mimeType: j.mimeType,
    size: j.size ? Number(j.size) : null,
    modifiedTime: j.modifiedTime ? new Date(j.modifiedTime) : null,
    webViewLink: j.webViewLink ?? null,
    path: [],
    terbitanMarlin: j.appProperties?.[MARLIN_APP_PROPERTY] === "1",
  };
}

/**
 * Dokumen native Google tidak punya isi biner — harus diekspor. Peta ini juga
 * jadi daftar putih: jenis native lain (Form, Drawing, Site) tidak diimpor.
 */
export const GOOGLE_NATIVE_EXPORT: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
};

/**
 * Unduh isi file Drive. File biasa lewat `alt=media`; dokumen native Google
 * lewat `export`. `maxBytes` menjaga memori proses: Drive tidak selalu
 * melaporkan ukuran (native docs), jadi batas dicek pada hasil unduhan juga.
 */
export async function downloadDriveFile(
  fileId: string,
  mimeType: string,
  maxBytes: number,
): Promise<{ data: Buffer; mime: string; extension: string | null }> {
  const token = await getAccessToken();
  const native = GOOGLE_NATIVE_EXPORT[mimeType];
  const url = native
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export` +
      `?mimeType=${encodeURIComponent(native.mime)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
      `?alt=media&supportsAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new GDriveError(`Gagal mengunduh file dari Drive: ${await readError(res)}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.byteLength > maxBytes) {
    throw new GDriveError(
      `Ukuran file ${(data.byteLength / 1024 / 1024).toFixed(1)} MB melebihi batas ${Math.round(
        maxBytes / 1024 / 1024,
      )} MB`,
    );
  }
  return {
    data,
    mime: native?.mime ?? mimeType,
    extension: native?.ext ?? null,
  };
}
