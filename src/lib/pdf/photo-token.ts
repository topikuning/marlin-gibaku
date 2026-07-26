import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Token foto publik-tapi-milik-MARLIN: link foto di PDF (yang dikirim ke WA)
 * harus bisa dibuka SIAPA SAJA tanpa login, tetap lewat MARLIN, dan PERMANEN.
 * Caranya: tanda tangan HMAC (SESSION_SECRET) atas photoId — hanya link yang
 * DIBUAT MARLIN yang valid (bukan tebak id), tanpa kedaluwarsa. Merotasi
 * SESSION_SECRET otomatis mematikan semua link lama. DECISIONS 125.
 */

function sign(photoId: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(`foto:${photoId}`).digest("base64url");
}

/** token = base64url(photoId).signature — dipakai di URL /api/foto/[token]. */
export function signPhotoToken(photoId: string): string {
  return `${Buffer.from(photoId, "utf8").toString("base64url")}.${sign(photoId)}`;
}

/** Verifikasi token → photoId, atau null bila tak valid/rusak. Bandingkan timing-safe. */
export function verifyPhotoToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  let photoId: string;
  try {
    photoId = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!photoId) return null;
  const got = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(photoId));
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return photoId;
}
