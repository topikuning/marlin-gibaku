import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ExifReader from "exifreader";
import { db } from "@/lib/db";
import { isR2Configured, r2Put, r2PresignGet } from "@/lib/r2";

/**
 * Pipeline foto lapangan (port dari modul lama, arsitektur baru):
 *   kompresi sharp (rotate + resize maks 1920, webp) + thumbnail ≤480
 *   + cap teks waktu/koordinat gaya Timemark DIBAKAR ke gambar
 *   + dedup sha256 (byte-identik ditolak) + EXIF GPS/waktu via exifreader.
 * Key R2: photos/{locationSlug}/{dateKey}/{uuid}.webp (+ .thumb.webp).
 */

/**
 * Arahkan fontconfig ke font yang DIBUNDEL bersama repo, sebelum sharp/librsvg
 * merender teks. Tanpa ini, host tanpa font (mis. Railway) merender teks SVG
 * jadi KOSONG → cap foto tampak "tidak ada".
 *
 * PENTING: config fontconfig DITULIS SAAT RUNTIME dengan path ABSOLUT +
 * cachedir yang PASTI writable. Config statik lama (dir relatif "." + cachedir
 * relatif + scan /usr/share/fonts) membuat librsvg MENGGANTUNG selamanya saat
 * merender teks → unggahan foto stuck & tak pernah sampai ke bucket. Config
 * runtime ini render teks dalam ~16ms (terverifikasi). Dijalankan sekali saat
 * modul dimuat.
 */
function ensureBundledFonts(): void {
  if (process.env.FONTCONFIG_FILE) return;
  const fontsDir = path.join(process.cwd(), "assets", "fonts");
  if (!existsSync(path.join(fontsDir, "DejaVuSans.ttf"))) return;
  try {
    const cacheDir = path.join(os.tmpdir(), "marlin-fontcache");
    mkdirSync(cacheDir, { recursive: true });
    const conf = path.join(os.tmpdir(), "marlin-fonts.conf");
    // Hanya daftarkan dir font bundel (absolut) + cachedir writable. TIDAK scan
    // /usr/share/fonts (sumber hang & lambat). sans-serif → DejaVu Sans bundel.
    writeFileSync(
      conf,
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontsDir}</dir>
  <cachedir>${cacheDir}</cachedir>
  <alias><family>sans-serif</family><prefer><family>DejaVu Sans</family></prefer></alias>
</fontconfig>
`,
    );
    process.env.FONTCONFIG_FILE = conf;
    process.env.FONTCONFIG_PATH = fontsDir;
  } catch (err) {
    // Gagal menyiapkan config → biarkan fontconfig sistem. Cap mungkin kosong,
    // tapi pipeline TIDAK boleh gagal karena ini.
    console.error("[photos] gagal menyiapkan fontconfig bundel:", err);
  }
}
ensureBundledFonts();

/** Sisi terpanjang gambar utama & thumbnail (px). */
const MAIN_MAX = 1920;
const THUMB_MAX = 480;

/** Batas ukuran & jumlah foto per unggahan (SM di lapangan, sinyal terbatas). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB / foto
export const MAX_PHOTOS_PER_UPLOAD = 6;

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const EXT_RE = /\.(jpe?g|png|webp|heic|heif)$/i;

export function isAllowedImage(mime: string, name: string): boolean {
  return ALLOWED_MIME.includes(mime.toLowerCase()) || EXT_RE.test(name);
}

export class PhotoError extends Error {}

/**
 * sharp dimuat LAZY hanya saat memproses unggahan. Import top-level membuat
 * SEMUA halaman yang menyentuh modul foto ikut crash (500) bila binari native
 * @img/sharp-* tidak tersedia di runtime — cukup unggahan yang gagal dgn pesan jelas.
 */
async function loadSharp(): Promise<typeof import("sharp")["default"]> {
  try {
    const mod = await import("sharp");
    return mod.default;
  } catch (err) {
    console.error("[photos] sharp tidak tersedia:", err);
    throw new PhotoError("Pemrosesan gambar tidak tersedia di server ini — hubungi admin");
  }
}

const TZ = "Asia/Jakarta";

/** Baca EXIF (tanggal ambil + GPS) dari buffer foto. Toleran bila tak ada. */
function readExif(buffer: Buffer): { takenAt: Date | null; lat: number | null; lng: number | null } {
  try {
    const tags = ExifReader.load(buffer, { expanded: true });
    let takenAt: Date | null = null;
    const dt = tags.exif?.DateTimeOriginal?.description ?? tags.exif?.DateTime?.description ?? null;
    if (dt) {
      // Format EXIF "YYYY:MM:DD HH:MM:SS" → ISO.
      const m = dt.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      if (m) {
        const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
        if (!Number.isNaN(d.getTime())) takenAt = d;
      }
    }
    const lat = typeof tags.gps?.Latitude === "number" ? tags.gps.Latitude : null;
    const lng = typeof tags.gps?.Longitude === "number" ? tags.gps.Longitude : null;
    return { takenAt, lat, lng };
  } catch {
    return { takenAt: null, lat: null, lng: null };
  }
}

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string,
  );
}

/** Data untuk cap foto (dibakar ke gambar sebelum simpan). */
export type PhotoStamp = {
  takenAt: Date;
  lat: number | null;
  lng: number | null;
  locationLabel: string | null;
};

function fmtCoord(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  const la = `${Math.abs(lat).toFixed(6)}°${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lng).toFixed(6)}°${lng >= 0 ? "E" : "W"}`;
  return `${la}, ${lo}`;
}

/** Bangun overlay SVG (gaya Timemark) seukuran gambar. */
function stampSvg(w: number, h: number, s: PhotoStamp): string {
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(s.takenAt);
  const date = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ }).format(s.takenAt);
  const day = new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: TZ }).format(s.takenAt);
  const coord = fmtCoord(s.lat, s.lng);
  const loc = s.locationLabel?.trim() || null;

  const band = Math.round(Math.min(h * 0.28, Math.max(140, w * 0.22)));
  const y0 = h - band;
  const pad = Math.round(w * 0.03);
  const fsTime = Math.round(band * 0.34);
  const fsText = Math.round(band * 0.135);
  const barX = pad + Math.round(fsTime * 3.05);
  const infoX = barX + Math.round(w * 0.022);

  const lines: string[] = [];
  lines.push(`<rect x="0" y="${y0}" width="${w}" height="${band}" fill="url(#mg)"/>`);
  lines.push(`<text x="${pad}" y="${y0 + Math.round(band * 0.45)}" font-family="sans-serif" font-weight="700" font-size="${fsTime}" fill="#ffffff">${time}</text>`);
  lines.push(`<rect x="${barX}" y="${y0 + Math.round(band * 0.14)}" width="${Math.max(3, Math.round(w * 0.006))}" height="${Math.round(band * 0.34)}" fill="#f59e0b"/>`);
  lines.push(`<text x="${infoX}" y="${y0 + Math.round(band * 0.28)}" font-family="sans-serif" font-weight="600" font-size="${fsText}" fill="#ffffff">${esc(date)}</text>`);
  lines.push(`<text x="${infoX}" y="${y0 + Math.round(band * 0.45)}" font-family="sans-serif" font-size="${fsText}" fill="#e2e8f0">${esc(day)}</text>`);
  if (loc)
    lines.push(`<text x="${pad}" y="${y0 + Math.round(band * 0.70)}" font-family="sans-serif" font-weight="600" font-size="${Math.round(fsText * 1.02)}" fill="#ffffff">${esc(loc.slice(0, 60))}</text>`);
  if (coord)
    lines.push(`<text x="${pad}" y="${y0 + Math.round(band * 0.90)}" font-family="sans-serif" font-size="${fsText}" fill="#ffffff">Koordinat: ${esc(coord)}</text>`);
  lines.push(`<text x="${w - pad}" y="${y0 + Math.round(band * 0.90)}" text-anchor="end" font-family="sans-serif" font-weight="700" font-size="${fsText}" fill="#f59e0b">MARLIN</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.62"/></linearGradient></defs>${lines.join("")}</svg>`;
}

export type SavePhotoInput = {
  reportId: string;
  reportItemId?: string | null;
  file: File;
  userId: string;
  locationSlug: string;
  dateKey: string;
  /** Sumber cap dari klien (geolokasi + waktu ambil); fallback EXIF → now. */
  stamp?: { lat?: number | null; lng?: number | null; takenAt?: Date | null; locationLabel?: string | null };
};

/**
 * Simpan SATU foto: validasi → dedup sha256 → kompresi + cap → R2 → row Photo.
 * Duplikat byte-identik ditolak dengan error (anti dobel bukti).
 */
export async function savePhotoForItem(input: SavePhotoInput) {
  if (!isR2Configured()) throw new PhotoError("Penyimpanan foto belum dikonfigurasi");
  const { file } = input;
  if (file.size === 0) throw new PhotoError("File foto kosong");
  if (file.size > MAX_PHOTO_BYTES) throw new PhotoError("Foto terlalu besar (maks 8 MB)");
  if (!isAllowedImage(file.type, file.name)) throw new PhotoError("Format foto tidak didukung (JPG/PNG/WebP/HEIC)");

  const original = Buffer.from(await file.arrayBuffer());
  // Dedup pakai sha256 sumber ASLI (cap sama foto = tetap dianggap sama).
  const sha256 = createHash("sha256").update(original).digest("hex");
  const existing = await db.photo.findUnique({ where: { sha256 }, select: { id: true } });
  if (existing) throw new PhotoError("Foto duplikat (sudah pernah diunggah)");

  const exif = readExif(original);
  const lat = input.stamp?.lat ?? exif.lat;
  const lng = input.stamp?.lng ?? exif.lng;
  const takenAt = input.stamp?.takenAt ?? exif.takenAt ?? new Date();

  // Pipeline ideal: sharp resize + cap (Timemark) + webp. Bila sharp TIDAK
  // tersedia/gagal di runtime (mis. binari native tak termuat di host), JANGAN
  // menggagalkan unggahan — simpan gambar ASLI apa adanya supaya foto tetap
  // masuk bucket & tampil (tanpa cap). Ini mencegah "foto hilang, bucket kosong"
  // saat sharp bermasalah, sekaligus tetap memakai cap bila sharp sehat.
  const processed = await processWithSharpOrOriginal(
    original,
    { takenAt, lat, lng, locationLabel: input.stamp?.locationLabel ?? null },
    file,
  );

  const uuid = randomUUID();
  const key = `photos/${input.locationSlug}/${input.dateKey}/${uuid}.${processed.ext}`;
  await r2Put(key, processed.main, processed.contentType);
  let thumbnailKey: string | null = null;
  if (processed.thumb) {
    thumbnailKey = `photos/${input.locationSlug}/${input.dateKey}/${uuid}.thumb.webp`;
    try {
      await r2Put(thumbnailKey, processed.thumb, "image/webp");
    } catch {
      thumbnailKey = null;
    }
  }

  return db.photo.create({
    data: {
      reportId: input.reportId,
      reportItemId: input.reportItemId ?? null,
      r2Key: key,
      thumbnailKey,
      sha256,
      bytes: processed.main.length,
      widthPx: processed.width,
      heightPx: processed.height,
      exifTakenAt: takenAt,
      exifGpsLat: lat != null ? lat.toFixed(7) : null,
      exifGpsLng: lng != null ? lng.toFixed(7) : null,
      verification: "pending",
      uploadedById: input.userId,
    },
  });
}

type ProcessedPhoto = {
  main: Buffer;
  thumb: Buffer | null;
  contentType: string;
  ext: string;
  width: number | null;
  height: number | null;
};

/** MIME → ekstensi berkas untuk fallback simpan-asli. */
function mimeExt(mime: string, name: string): { contentType: string; ext: string } {
  const m = mime.toLowerCase();
  if (m === "image/jpeg" || /\.jpe?g$/i.test(name)) return { contentType: "image/jpeg", ext: "jpg" };
  if (m === "image/png" || /\.png$/i.test(name)) return { contentType: "image/png", ext: "png" };
  if (m === "image/webp" || /\.webp$/i.test(name)) return { contentType: "image/webp", ext: "webp" };
  if (m === "image/heic" || m === "image/heif" || /\.hei[cf]$/i.test(name))
    return { contentType: m || "image/heic", ext: "heic" };
  return { contentType: mime || "application/octet-stream", ext: "img" };
}

/**
 * Proses gambar dgn sharp (resize + cap + webp). Bila sharp tak tersedia atau
 * memprosesnya gagal, kembalikan gambar ASLI (contentType sesuai sumber) supaya
 * unggahan tetap berhasil — cap dilewati, foto tetap tersimpan & tampil.
 */
async function processWithSharpOrOriginal(
  original: Buffer,
  stamp: PhotoStamp,
  file?: File,
): Promise<ProcessedPhoto> {
  let sharp: Awaited<ReturnType<typeof loadSharp>>;
  try {
    sharp = await loadSharp();
  } catch (err) {
    console.error("[photos] sharp tak tersedia — simpan gambar asli tanpa cap:", err);
    const { contentType, ext } = mimeExt(file?.type ?? "", file?.name ?? "");
    return { main: original, thumb: null, contentType, ext, width: null, height: null };
  }

  try {
    const resized = await withTimeout(
      sharp(original, { failOn: "none" })
        .rotate()
        .resize(MAIN_MAX, MAIN_MAX, { fit: "inside", withoutEnlargement: true })
        .toBuffer({ resolveWithObject: true }),
      SHARP_TIMEOUT_MS,
      "resize",
    );
    const width = resized.info.width ?? null;
    const height = resized.info.height ?? null;
    let pipeline = sharp(resized.data, { failOn: "none" });
    if (width && height) {
      const svg = stampSvg(width, height, stamp);
      pipeline = pipeline.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);
    }
    // Composite teks (librsvg+fontconfig) = titik paling rawan menggantung.
    // Timeout → fallback simpan-asli, JANGAN biarkan unggahan stuck selamanya.
    const main = await withTimeout(pipeline.webp({ quality: 80 }).toBuffer(), SHARP_TIMEOUT_MS, "cap");

    let thumb: Buffer | null = null;
    try {
      thumb = await withTimeout(
        sharp(main, { failOn: "none" })
          .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 70 })
          .toBuffer(),
        SHARP_TIMEOUT_MS,
        "thumb",
      );
    } catch {
      thumb = null; // thumbnail opsional; grid fallback ke gambar utama
    }
    return { main, thumb, contentType: "image/webp", ext: "webp", width, height };
  } catch (err) {
    console.error("[photos] sharp gagal/timeout memproses — simpan gambar asli tanpa cap:", err);
    const { contentType, ext } = mimeExt(file?.type ?? "", file?.name ?? "");
    return { main: original, thumb: null, contentType, ext, width: null, height: null };
  }
}

/** Batas waktu proses sharp per tahap; lewat batas → fallback simpan-asli. */
const SHARP_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`sharp ${label} timeout ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

/**
 * Diagnostik: verifikasi sharp benar-benar bisa memproses gambar di runtime ini
 * (bukan sekadar ter-import) — buat gambar kecil, resize, cap SVG, encode webp.
 * Dipakai di menu Sistem supaya jelas apakah cap foto akan berjalan di host.
 */
export async function sharpSelfTest(): Promise<{ ok: boolean; detail: string }> {
  try {
    const sharp = await loadSharp();
    const base = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 30, g: 58, b: 138 } },
    })
      .png()
      .toBuffer();
    const svg = stampSvg(320, 240, { takenAt: new Date(0), lat: -6.9, lng: 110.4, locationLabel: "Uji" });
    const out = await sharp(base)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .webp({ quality: 80 })
      .toBuffer();
    return { ok: out.length > 0, detail: `webp ${out.length} bytes (resize + cap OK)` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Data foto siap-tampil (thumbnail kecil + full + tag EXIF). */
export type PhotoView = {
  id: string;
  reportItemId?: string | null;
  thumbUrl?: string;
  fullUrl?: string;
  takenAt: string | null; // ISO
  lat: number | null;
  lng: number | null;
};

type PhotoRow = {
  id: string;
  r2Key: string;
  thumbnailKey?: string | null;
  reportItemId?: string | null;
  exifTakenAt?: Date | null;
  exifGpsLat?: { toString(): string } | null;
  exifGpsLng?: { toString(): string } | null;
};

/** Presign sekumpulan r2Key jadi URL sementara (untuk <img src>). */
export async function presignKeys(keys: string[], expiresIn = 300): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!isR2Configured()) return map;
  const unique = [...new Set(keys)];
  await Promise.all(
    unique.map(async (k) => {
      try {
        map.set(k, await r2PresignGet(k, expiresIn));
      } catch {
        /* biarkan kosong; UI tampilkan placeholder */
      }
    }),
  );
  return map;
}

/**
 * Bangun daftar PhotoView terpresign (default 300 detik). Thumbnail dipakai
 * di grid (ringan), full di lightbox. Tanpa thumbnail → fallback full.
 */
export async function buildPhotoViews(photos: PhotoRow[], expiresIn = 300): Promise<PhotoView[]> {
  const keys = new Set<string>();
  for (const p of photos) {
    keys.add(p.r2Key);
    if (p.thumbnailKey) keys.add(p.thumbnailKey);
  }
  const urls = await presignKeys([...keys], expiresIn);
  return photos.map((p) => {
    const fullUrl = urls.get(p.r2Key);
    const thumbUrl = p.thumbnailKey ? urls.get(p.thumbnailKey) : fullUrl;
    return {
      id: p.id,
      reportItemId: p.reportItemId ?? null,
      thumbUrl: thumbUrl ?? fullUrl,
      fullUrl,
      takenAt: p.exifTakenAt ? p.exifTakenAt.toISOString() : null,
      lat: p.exifGpsLat != null ? Number(p.exifGpsLat.toString()) : null,
      lng: p.exifGpsLng != null ? Number(p.exifGpsLng.toString()) : null,
    };
  });
}
