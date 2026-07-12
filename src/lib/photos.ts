import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { r2Put, r2PresignGet, isR2Configured } from "@/lib/r2";

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
    const key = `report-photos/${reportItemId}/${sha256.slice(0, 16)}${ext}`;
    await r2Put(key, buffer, file.type || "image/jpeg");
    await db.photo.create({
      data: {
        reportItemId,
        r2Key: key,
        sha256,
        bytes: buffer.length,
        verification: "pending",
      },
    });
    saved++;
  }
  return { saved, skipped };
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
