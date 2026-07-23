import { createHash, randomUUID } from "node:crypto";
import ExifReader from "exifreader";
import { db } from "@/lib/db";
import { isR2Configured, r2Put, r2PresignGet } from "@/lib/r2";
import { STAMP_FONT_REGULAR_B64, STAMP_FONT_BOLD_B64 } from "@/lib/stamp-font";

/**
 * Pipeline foto lapangan (port dari modul lama, arsitektur baru):
 *   kompresi sharp (rotate + resize maks 1920, webp) + thumbnail ≤480
 *   + cap teks waktu/koordinat gaya Timemark DIBAKAR ke gambar
 *   + dedup sha256 (byte-identik ditolak) + EXIF GPS/waktu via exifreader.
 * Key R2: photos/{locationSlug}/{dateKey}/{uuid}.webp (+ .thumb.webp).
 */

/*
 * CATATAN fontconfig (jangan diulang): dulu ada ensureBundledFonts() yang
 * menulis config fontconfig custom saat runtime. TERBUKTI justru MERUSAK
 * @font-face data-URI di SVG cap — pango gagal mencocokkan font embedded dan
 * jatuh ke serif default (direproduksi: SVG sama + sharp sama, hanya beda
 * FONTCONFIG_FILE → hasil serif). Font cap kini DIBENAMKAN base64 ke SVG
 * (lihat FONT_FACE_CSS) dan bekerja dengan fontconfig default MAUPUN rusak —
 * jadi JANGAN pernah menyetel FONTCONFIG_FILE/FONTCONFIG_PATH dari kode ini.
 */

/** Sisi terpanjang gambar utama & thumbnail (px). Thumbnail tampil ≤64px di grid
 * (retina ≈128px) → 256px sudah lebih dari cukup & hemat resource. */
const MAIN_MAX = 1920;
const THUMB_MAX = 256;

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

/**
 * Font DIBENAMKAN langsung ke SVG (base64 @font-face) — librsvg TIDAK perlu
 * fontconfig/font sistem untuk menemukan glyph, jadi cap teks PASTI ter-render
 * di host mana pun (terverifikasi: render mulus walau fontconfig sengaja dirusak).
 *
 * Base64 font di-IMPOR sebagai KONSTANTA (src/lib/stamp-font.ts, subset Latin +
 * simbol ~50KB) — BUKAN dibaca dari filesystem saat runtime. Jadi cap tidak
 * bergantung pada cwd/berkas yang harus ikut ter-copy di container (dugaan
 * penyebab cap hilang di Railway: path assets/fonts tak ketemu → fallback
 * "sans-serif" yang kosong tanpa font sistem).
 */
const EMBED_FONTS = Boolean(STAMP_FONT_REGULAR_B64 && STAMP_FONT_BOLD_B64);
/** Keluarga font yang dipakai teks stamp: "MB" (embedded) atau fallback sistem. */
const STAMP_FAMILY = EMBED_FONTS ? "MB" : "sans-serif";
const FONT_FACE_CSS = EMBED_FONTS
  ? `<style>` +
    `@font-face{font-family:'MB';font-weight:400;src:url(data:font/ttf;base64,${STAMP_FONT_REGULAR_B64}) format('truetype');}` +
    `@font-face{font-family:'MB';font-weight:700;src:url(data:font/ttf;base64,${STAMP_FONT_BOLD_B64}) format('truetype');}` +
    `</style>`
  : "";

/** Data untuk cap foto (dibakar ke gambar sebelum simpan). */
export type PhotoStamp = {
  takenAt: Date;
  lat: number | null;
  lng: number | null;
  locationLabel: string | null;
  /** Nama perusahaan (header cap). */
  companyName?: string | null;
  /** Nama pelapor (user yang mengunggah). */
  reporterName?: string | null;
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
  const company = s.companyName?.trim() || null;
  const reporter = s.reporterName?.trim() || null;

  // Band lebih tinggi utk menampung header perusahaan + baris pelapor.
  const band = Math.round(Math.min(h * 0.36, Math.max(200, w * 0.32)));
  const y0 = h - band;
  const pad = Math.round(w * 0.03);
  const fsTime = Math.round(band * 0.2);
  const fsText = Math.round(band * 0.098);
  const fsSmall = Math.round(band * 0.082);
  const fsCompany = Math.round(band * 0.105);
  // Baris waktu diletakkan di bawah header perusahaan.
  const timeY = y0 + Math.round(band * 0.5);
  const barX = pad + Math.round(fsTime * 3.5);
  const infoX = barX + Math.round(w * 0.022);

  // Hanya 2 berat font dibenamkan (400 & 700); pakai 700 untuk penekanan.
  const ff = STAMP_FAMILY;
  const lines: string[] = [];
  lines.push(`<rect x="0" y="${y0}" width="${w}" height="${band}" fill="url(#mg)"/>`);
  // Header: nama perusahaan + aksen oranye + MARLIN di kanan.
  if (company) {
    lines.push(`<rect x="${pad}" y="${y0 + Math.round(band * 0.075)}" width="${Math.max(4, Math.round(w * 0.007))}" height="${Math.round(band * 0.11)}" fill="#f59e0b"/>`);
    lines.push(`<text x="${pad + Math.round(w * 0.018)}" y="${y0 + Math.round(band * 0.17)}" font-family="${ff}" font-weight="700" font-size="${fsCompany}" fill="#ffffff">${esc(company.slice(0, 46))}</text>`);
  }
  lines.push(`<text x="${w - pad}" y="${y0 + Math.round(band * 0.17)}" text-anchor="end" font-family="${ff}" font-weight="700" font-size="${fsCompany}" fill="#f59e0b">MARLIN</text>`);
  lines.push(`<line x1="${pad}" y1="${y0 + Math.round(band * 0.225)}" x2="${w - pad}" y2="${y0 + Math.round(band * 0.225)}" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.5"/>`);
  // Waktu besar + bar + tanggal/hari.
  lines.push(`<text x="${pad}" y="${timeY}" font-family="${ff}" font-weight="700" font-size="${fsTime}" fill="#ffffff">${time}</text>`);
  lines.push(`<rect x="${barX}" y="${y0 + Math.round(band * 0.32)}" width="${Math.max(3, Math.round(w * 0.006))}" height="${Math.round(band * 0.2)}" fill="#f59e0b"/>`);
  lines.push(`<text x="${infoX}" y="${y0 + Math.round(band * 0.42)}" font-family="${ff}" font-weight="700" font-size="${fsText}" fill="#ffffff">${esc(date)}</text>`);
  lines.push(`<text x="${infoX}" y="${y0 + Math.round(band * 0.51)}" font-family="${ff}" font-weight="400" font-size="${fsText}" fill="#e2e8f0">${esc(day)}</text>`);
  // Lokasi + koordinat.
  if (loc)
    lines.push(`<text x="${pad}" y="${y0 + Math.round(band * 0.66)}" font-family="${ff}" font-weight="700" font-size="${Math.round(fsText * 1.02)}" fill="#ffffff">${esc(loc.slice(0, 60))}</text>`);
  if (coord)
    lines.push(`<text x="${pad}" y="${y0 + Math.round(band * 0.78)}" font-family="${ff}" font-weight="400" font-size="${fsSmall}" fill="#ffffff">Koordinat: ${esc(coord)}</text>`);
  // Pelapor.
  if (reporter)
    lines.push(`<text x="${pad}" y="${y0 + Math.round(band * 0.92)}" font-family="${ff}" font-weight="400" font-size="${fsSmall}" fill="#e2e8f0">Dilaporkan oleh: <tspan font-weight="700" fill="#ffffff">${esc(reporter.slice(0, 40))}</tspan></text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${FONT_FACE_CSS}<linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.68"/></linearGradient></defs>${lines.join("")}</svg>`;
}

export type SavePhotoInput = {
  /** Salah satu wajib diisi: reportId (laporan harian) ATAU activityId (kegiatan lapangan). */
  reportId?: string | null;
  reportItemId?: string | null;
  activityId?: string | null;
  file: File;
  userId: string;
  locationSlug: string;
  dateKey: string;
  /** Sumber cap dari klien (geolokasi + waktu ambil); fallback EXIF → now. */
  stamp?: {
    lat?: number | null;
    lng?: number | null;
    takenAt?: Date | null;
    locationLabel?: string | null;
    companyName?: string | null;
    reporterName?: string | null;
  };
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
    {
      takenAt,
      lat,
      lng,
      locationLabel: input.stamp?.locationLabel ?? null,
      companyName: input.stamp?.companyName ?? null,
      reporterName: input.stamp?.reporterName ?? null,
    },
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
      reportId: input.reportId ?? null,
      reportItemId: input.reportItemId ?? null,
      activityId: input.activityId ?? null,
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

  // TAHAP 1 — resize + orientasi (TIDAK butuh font). Wajib: hemat storage &
  // bandwidth (jangan pernah simpan foto kamera mentah 3–8 MB).
  let resizedData: Buffer;
  let width: number | null;
  let height: number | null;
  try {
    const resized = await withTimeout(
      sharp(original, { failOn: "none" })
        .rotate()
        .resize(MAIN_MAX, MAIN_MAX, { fit: "inside", withoutEnlargement: true })
        .toBuffer({ resolveWithObject: true }),
      SHARP_TIMEOUT_MS,
      "resize",
    );
    resizedData = resized.data;
    width = resized.info.width ?? null;
    height = resized.info.height ?? null;
  } catch (err) {
    console.error("[photos] sharp gagal resize — simpan gambar asli:", err);
    const { contentType, ext } = mimeExt(file?.type ?? "", file?.name ?? "");
    return { main: original, thumb: null, contentType, ext, width: null, height: null };
  }

  // TAHAP 2 — cap Timemark (BUTUH font: librsvg+fontconfig, titik paling rawan
  // menggantung). Best-effort: bila gagal/timeout, pakai gambar hasil resize
  // TANPA cap. Foto tetap terproses & kecil; cap boleh menyusul bila font sehat.
  let main: Buffer;
  try {
    if (!width || !height) throw new Error("dimensi tidak diketahui");
    const svg = stampSvg(width, height, stamp);
    main = await withTimeout(
      sharp(resizedData, { failOn: "none" })
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .webp({ quality: 80 })
        .toBuffer(),
      SHARP_TIMEOUT_MS,
      "cap",
    );
  } catch (err) {
    console.error("[photos] cap gagal/timeout — simpan hasil resize tanpa cap:", err);
    main = await sharp(resizedData, { failOn: "none" }).webp({ quality: 80 }).toBuffer();
  }

  // TAHAP 3 — thumbnail kecil (TIDAK butuh font). Selalu dibuat supaya grid tak
  // pernah memuat gambar penuh (hemat resource).
  let thumb: Buffer | null = null;
  try {
    thumb = await withTimeout(
      sharp(main, { failOn: "none" })
        .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 68 })
        .toBuffer(),
      SHARP_TIMEOUT_MS,
      "thumb",
    );
  } catch {
    thumb = null; // thumbnail opsional; grid fallback ke gambar utama
  }
  return { main, thumb, contentType: "image/webp", ext: "webp", width, height };
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
 * (bukan sekadar ter-import) — buat gambar, resize, cap SVG (font DIBENAMKAN),
 * encode webp, DAN kembalikan pratinjau (data URI) supaya admin bisa MELIHAT
 * langsung apakah cap ter-render di host itu. Dipakai di menu Sistem.
 */
export async function sharpSelfTest(): Promise<{ ok: boolean; detail: string; sampleDataUri?: string }> {
  // Muat sharp langsung (bukan lewat loadSharp) supaya ERROR ASLI muncul di
  // diagnostik — mis. "Cannot find module '@img/sharp-linux-x64'" → jelas apakah
  // masalahnya binari native sharp, bukan sekadar "tidak tersedia".
  let sharp: typeof import("sharp")["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return { ok: false, detail: `sharp gagal dimuat: ${msg}`.slice(0, 600) };
  }
  try {
    const W = 640;
    const H = 480;
    const base = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 90, g: 105, b: 120 } },
    })
      .png()
      .toBuffer();
    const svg = stampSvg(W, H, {
      takenAt: new Date("2026-07-15T07:56:00+07:00"),
      lat: -6.19762,
      lng: 106.817,
      locationLabel: "Contoh Lokasi, Demak",
      companyName: "PT Contoh Perusahaan",
      reporterName: "Budi Santoso",
    });
    const out = await sharp(base)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .webp({ quality: 80 })
      .toBuffer();
    const fontMode = EMBED_FONTS ? "font dibenamkan" : "font sistem (embed gagal!)";
    return {
      ok: out.length > 0,
      detail: `webp ${out.length} bytes · resize + cap OK · ${fontMode}`,
      sampleDataUri: `data:image/webp;base64,${out.toString("base64")}`,
    };
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
