import { createHash } from "node:crypto";
import sharp from "sharp";
import ExifReader from "exifreader";
import { db } from "@/lib/db";
import { r2Put, r2PresignGet, isR2Configured } from "@/lib/r2";

/** Ukuran sisi terpanjang thumbnail (px). Kecil = ringan di-load. */
const THUMB_MAX = 480;

type ExtractedMeta = {
  takenAt: Date | null;
  lat: number | null;
  lng: number | null;
  width: number | null;
  height: number | null;
};

/** Baca EXIF (tanggal ambil + GPS) dari buffer foto. Toleran bila tak ada. */
function readExif(buffer: Buffer): { takenAt: Date | null; lat: number | null; lng: number | null } {
  try {
    const tags = ExifReader.load(buffer, { expanded: true });
    let takenAt: Date | null = null;
    const dt =
      tags.exif?.DateTimeOriginal?.description ??
      tags.exif?.DateTime?.description ??
      null;
    if (dt) {
      // Format EXIF "YYYY:MM:DD HH:MM:SS" → ISO.
      const m = dt.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      if (m) {
        const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
        if (!Number.isNaN(d.getTime())) takenAt = d;
      }
    }
    const lat =
      typeof tags.gps?.Latitude === "number" ? tags.gps.Latitude : null;
    const lng =
      typeof tags.gps?.Longitude === "number" ? tags.gps.Longitude : null;
    return { takenAt, lat, lng };
  } catch {
    return { takenAt: null, lat: null, lng: null };
  }
}

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string
  );
}

const TZ = "Asia/Jakarta";

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

/** Bakar cap ke gambar. Kalau gagal, kembalikan buffer asli. */
async function burnStamp(buffer: Buffer, s: PhotoStamp): Promise<Buffer> {
  try {
    const img = sharp(buffer, { failOn: "none" }).rotate();
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return buffer;
    const svg = stampSvg(w, h, s);
    return await img
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    return buffer;
  }
}

/** Buat thumbnail webp kecil + baca dimensi & EXIF. Kembalikan thumb buffer + meta. */
async function processImage(
  buffer: Buffer
): Promise<{ thumb: Buffer | null; meta: ExtractedMeta }> {
  const exif = readExif(buffer);
  try {
    const img = sharp(buffer, { failOn: "none" }).rotate();
    const meta = await img.metadata();
    const thumb = await img
      .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();
    return {
      thumb,
      meta: {
        ...exif,
        width: meta.width ?? null,
        height: meta.height ?? null,
      },
    };
  } catch {
    return { thumb: null, meta: { ...exif, width: null, height: null } };
  }
}

/** Batas ukuran & jumlah foto per item laporan (SM di lapangan, sinyal terbatas). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB / foto
export const MAX_PHOTOS_PER_ITEM = 6;

const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
const EXT_RE = /\.(jpe?g|png|webp|heic|heif)$/i;

export function isAllowedImage(mime: string, name: string): boolean {
  return ALLOWED_MIME.includes(mime.toLowerCase()) || EXT_RE.test(name);
}

export type SavePhotosResult = { saved: number; skipped: number };

/**
 * Simpan daftar foto ke R2 lalu buat row Photo yang menempel ke sebuah
 * DailyReportItem. Byte-identik (sha256 sama) dilewati agar tidak dobel.
 */
export async function savePhotosForReportItem(
  reportItemId: string,
  files: File[],
  stampBase?: { lat?: number | null; lng?: number | null; takenAt?: Date | null; locationLabel?: string | null }
): Promise<SavePhotosResult> {
  if (!isR2Configured())
    throw new Error("Penyimpanan (R2) belum dikonfigurasi.");

  let saved = 0;
  let skipped = 0;
  for (const file of files.slice(0, MAX_PHOTOS_PER_ITEM)) {
    if (file.size === 0) continue;
    if (file.size > MAX_PHOTO_BYTES || !isAllowedImage(file.type, file.name)) {
      skipped++;
      continue;
    }
    const original = Buffer.from(await file.arrayBuffer());
    // Dedup pakai sha256 sumber asli (cap sama foto = tetap dianggap sama).
    const sha256 = createHash("sha256").update(original).digest("hex");
    const existing = await db.photo.findUnique({
      where: { sha256 },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    // Sumber tag: klien (geolokasi + waktu ambil) → EXIF → fallback.
    const exif = readExif(original);
    const lat = stampBase?.lat ?? exif.lat;
    const lng = stampBase?.lng ?? exif.lng;
    const takenAt = stampBase?.takenAt ?? exif.takenAt ?? new Date();

    // Bakar cap (waktu, lokasi, koordinat) ke gambar SEBELUM simpan.
    const stamped = await burnStamp(original, {
      takenAt,
      lat,
      lng,
      locationLabel: stampBase?.locationLabel ?? null,
    });

    const base = `report-photos/${reportItemId}/${sha256.slice(0, 16)}`;
    const key = `${base}.jpg`;
    const { thumb, meta } = await processImage(stamped);

    await r2Put(key, stamped, "image/jpeg");
    let thumbnailKey: string | null = null;
    if (thumb) {
      thumbnailKey = `${base}.thumb.webp`;
      try {
        await r2Put(thumbnailKey, thumb, "image/webp");
      } catch {
        thumbnailKey = null;
      }
    }

    await db.photo.create({
      data: {
        reportItemId,
        r2Key: key,
        thumbnailKey,
        sha256,
        bytes: stamped.length,
        widthPx: meta.width,
        heightPx: meta.height,
        exifTakenAt: takenAt,
        exifGpsLat: lat != null ? lat.toFixed(7) : null,
        exifGpsLng: lng != null ? lng.toFixed(7) : null,
        verification: "pending",
      },
    });
    saved++;
  }
  return { saved, skipped };
}

/** Data foto siap-tampil (thumbnail kecil + full + tag EXIF). */
export type PhotoView = {
  id: string;
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
  exifTakenAt?: Date | null;
  exifGpsLat?: { toString(): string } | null;
  exifGpsLng?: { toString(): string } | null;
};

/**
 * Bangun daftar PhotoView terpresign. Thumbnail dipakai di grid (ringan),
 * full dipakai di lightbox. Kalau tak ada thumbnail (foto lama), pakai full.
 */
export async function buildPhotoViews(
  photos: PhotoRow[],
  expiresIn = 600
): Promise<PhotoView[]> {
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
      thumbUrl: thumbUrl ?? fullUrl,
      fullUrl,
      takenAt: p.exifTakenAt ? p.exifTakenAt.toISOString() : null,
      lat: p.exifGpsLat != null ? Number(p.exifGpsLat.toString()) : null,
      lng: p.exifGpsLng != null ? Number(p.exifGpsLng.toString()) : null,
    };
  });
}

/** Presign sekumpulan r2Key jadi URL sementara (untuk <img src>). */
export async function presignKeys(
  keys: string[],
  expiresIn = 300
): Promise<Map<string, string>> {
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
    })
  );
  return map;
}
