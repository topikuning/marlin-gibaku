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
  files: File[]
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
    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    // Dedup: foto yang byte-nya persis sama tidak diunggah/dicatat dua kali.
    const existing = await db.photo.findUnique({
      where: { sha256 },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const ext = file.name.match(EXT_RE)?.[0]?.toLowerCase() ?? ".jpg";
    const base = `report-photos/${reportItemId}/${sha256.slice(0, 16)}`;
    const key = `${base}${ext}`;

    const { thumb, meta } = await processImage(buffer);
    await r2Put(key, buffer, file.type || "image/jpeg");
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
        bytes: buffer.length,
        widthPx: meta.width,
        heightPx: meta.height,
        exifTakenAt: meta.takenAt,
        exifGpsLat: meta.lat != null ? meta.lat.toFixed(7) : null,
        exifGpsLng: meta.lng != null ? meta.lng.toFixed(7) : null,
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
