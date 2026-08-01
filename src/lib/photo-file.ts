/**
 * Nama & tipe berkas foto — MODUL MURNI (tanpa db/sharp/node:crypto), supaya
 * bisa diuji unit tanpa menyalakan environment server.
 */

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

const EXT_RE = /\.(jpe?g|png|webp|heic|heif)$/i;

/**
 * Ekstensi berkas arsip ASLI (DECISIONS 197) — ikuti nama unggahan; bila tak
 * dikenali, pakai MIME; bila keduanya gelap, `.bin`. Isinya tetap byte asli
 * yang utuh, ekstensi hanya membantu saat berkasnya diunduh & dibuka.
 */
export function originalExt(name: string, mime: string): string {
  const m = EXT_RE.exec(name);
  if (m) return `.${m[1].toLowerCase()}`;
  return MIME_EXT[mime.toLowerCase()] ?? ".bin";
}
