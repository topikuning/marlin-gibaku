import { createHash, randomUUID } from "node:crypto";
import ExifReader from "exifreader";
import { db } from "@/lib/db";
import { isR2Configured, r2Put, r2PresignGet } from "@/lib/r2";
import { STAMP_FONT_REGULAR_B64, STAMP_FONT_BOLD_B64 } from "@/lib/stamp-font";
import { buildStampSvg, overlayAlphaFor, type StampRenderData } from "@/lib/photo-stamp/renderer";
import {
  formatStampDateTime,
  formatCoordinate,
  generatePhotoId,
  locationCodeFromName,
  DEFAULT_STAMP_TZ,
  type StampTimezone,
} from "@/lib/photo-stamp/format";
import { getPhotoStampConfig, DEFAULT_STAMP_ACCENT, type StampSize } from "@/lib/photo-stamp/config";
import type { PhotoMetadataSource } from "@/generated/prisma/enums";

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

/** Baca EXIF (tanggal ambil + GPS) dari buffer foto. Toleran bila tak ada. */
function readExif(buffer: Buffer): { takenAt: Date | null; lat: number | null; lng: number | null } {
  try {
    const tags = ExifReader.load(buffer, { expanded: true });
    let takenAt: Date | null = null;
    const dt = tags.exif?.DateTimeOriginal?.description ?? tags.exif?.DateTime?.description ?? null;
    if (dt) {
      // Format EXIF "YYYY:MM:DD HH:MM:SS" → ISO. EXIF menyimpan JAM DINDING tanpa
      // timezone; perlakukan sebagai zona proyek (WIB +07:00) supaya jam yang
      // dicap sama dengan yang tertulis di EXIF (tanpa +07:00 akan dianggap UTC
      // oleh server → tampil bergeser 7 jam saat diformat ke WIB).
      const m = dt.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      if (m) {
        const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`);
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

const SIZE_SCALE: Record<StampSize, number> = { compact: 0.85, standard: 1, large: 1.15 };

/** Data cap foto (dibakar ke gambar sebelum simpan). */
export type PhotoStamp = {
  takenAt: Date;
  lat: number | null;
  lng: number | null;
  locationLabel: string | null;
  companyName?: string | null;
  reporterName?: string | null;
  /** Badge kategori (nama pekerjaan utk laporan harian / kategori kegiatan). */
  categoryName?: string | null;
  photoId?: string | null;
  accentColor?: string;
  overlayAlpha?: number;
  sizeScale?: number;
  timezone?: StampTimezone;
  showCoordinate?: boolean;
  showReporter?: boolean;
  showPhotoId?: boolean;
  /** Waktu = fallback unggah (bukan jepret) → tampilkan penanda di cap. */
  timeApprox?: boolean;
};

/** Bangun overlay SVG mengikuti master layout (lihat photo-stamp/renderer). */
function stampSvg(w: number, h: number, s: PhotoStamp): string {
  const tz = s.timezone ?? DEFAULT_STAMP_TZ;
  const data: StampRenderData = {
    companyName: s.companyName?.trim() || null,
    locationName: s.locationLabel?.trim() || "—",
    categoryName: s.categoryName?.trim() || null,
    dateTimeText: formatStampDateTime(s.takenAt, tz),
    coordinateText: s.showCoordinate === false ? null : formatCoordinate(s.lat, s.lng),
    reporterName: s.showReporter === false ? null : s.reporterName?.trim() || null,
    photoId: s.showPhotoId === false ? null : s.photoId?.trim() || null,
    accentColor: s.accentColor || DEFAULT_STAMP_ACCENT,
    overlayAlpha: s.overlayAlpha ?? 0.9,
    sizeScale: s.sizeScale ?? 1,
    timeApprox: s.timeApprox ?? false,
  };
  return buildStampSvg(w, h, data, { fontFamily: STAMP_FAMILY, fontFaceCss: FONT_FACE_CSS });
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
  /**
   * Sumber cap. Prioritas GPS & waktu tergantung `source`:
   * - "camera" (foto baru diambil): GPS real-time perangkat → EXIF → titik lokasi proyek;
   *   waktu = sekarang → EXIF.
   * - "gallery" (dipilih dari galeri): UTAMAKAN EXIF asli foto; bila EXIF tak ada,
   *   cadangan sesuai `fallbackMode` ("project" = titik lokasi proyek, "none" = tanpa tag).
   *   GPS perangkat saat upload TIDAK PERNAH dipakai untuk galeri (bisa salah saat batch).
   */
  stamp?: {
    source?: "camera" | "gallery";
    fallbackMode?: "project" | "none";
    /** GPS real-time perangkat (hanya relevan utk source "camera"). */
    lat?: number | null;
    lng?: number | null;
    /** Koordinat lokasi proyek (fallback). */
    locationLat?: number | null;
    locationLng?: number | null;
    takenAt?: Date | null;
    /** Tanggal kerja kegiatan/laporan (fallback waktu utk galeri tanpa EXIF). */
    workDate?: Date | null;
    locationLabel?: string | null;
    companyName?: string | null;
    reporterName?: string | null;
    /** Badge kategori: nama pekerjaan (laporan harian) / kategori kegiatan. */
    categoryName?: string | null;
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
  const s = input.stamp;
  const source = s?.source ?? "camera";
  const projLat = s?.locationLat ?? null;
  const projLng = s?.locationLng ?? null;
  let lat: number | null;
  let lng: number | null;
  let takenAt: Date;
  // Sumber WAKTU cap: exif (metadata) / device (jam HP saat jepret) / server
  // (fallback waktu unggah — BUKAN waktu jepret asli). Disimpan + jadi penanda cap.
  let timeSource: PhotoMetadataSource;
  if (source === "gallery") {
    // Galeri: EXIF asli dulu; bila tak ada → cadangan (titik lokasi proyek / tanpa tag).
    // GPS perangkat saat upload sengaja diabaikan (bisa salah saat batch).
    const useProject = s?.fallbackMode === "project";
    lat = exif.lat ?? (useProject ? projLat : null);
    lng = exif.lng ?? (useProject ? projLng : null);
    if (exif.takenAt) {
      takenAt = exif.takenAt;
      timeSource = "exif";
    } else {
      // workDate = tanggal kerja (jam 00:00), bukan jam jepret asli → tandai server.
      takenAt = s?.workDate ?? new Date();
      timeSource = "server";
    }
  } else {
    // Kamera: GPS real-time perangkat dulu → EXIF → titik lokasi proyek.
    lat = s?.lat ?? exif.lat ?? projLat;
    lng = s?.lng ?? exif.lng ?? projLng;
    if (s?.takenAt) {
      takenAt = s.takenAt;
      timeSource = "device";
    } else if (exif.takenAt) {
      takenAt = exif.takenAt;
      timeSource = "exif";
    } else {
      takenAt = new Date();
      timeSource = "server";
    }
  }
  const timeApprox = timeSource === "server"; // waktu tak pasti = waktu unggah

  // Pipeline ideal: sharp resize + cap (Timemark) + webp. Bila sharp TIDAK
  // tersedia/gagal di runtime (mis. binari native tak termuat di host), JANGAN
  // menggagalkan unggahan — simpan gambar ASLI apa adanya supaya foto tetap
  // masuk bucket & tampil (tanpa cap). Ini mencegah "foto hilang, bucket kosong"
  // saat sharp bermasalah, sekaligus tetap memakai cap bila sharp sehat.
  // Konfigurasi stamp (warna aksen, overlay, ukuran, toggle) — best-effort.
  let cfg: Awaited<ReturnType<typeof getPhotoStampConfig>> | null = null;
  try {
    cfg = await getPhotoStampConfig();
  } catch {
    cfg = null;
  }
  const size: StampSize = cfg?.size ?? "standard";

  // Photo ID: <KODE-LOKASI>-<YYMMDD>-<HHMM>-<URUT> (urut per lokasi+hari).
  const prefix = `photos/${input.locationSlug}/${input.dateKey}/`;
  const seq = (await db.photo.count({ where: { r2Key: { startsWith: prefix } } })) + 1;
  const photoId = generatePhotoId(
    locationCodeFromName(input.stamp?.locationLabel ?? input.locationSlug),
    takenAt,
    seq,
    DEFAULT_STAMP_TZ,
  );

  const processed = await processWithSharpOrOriginal(
    original,
    {
      takenAt,
      lat,
      lng,
      locationLabel: input.stamp?.locationLabel ?? null,
      companyName: input.stamp?.companyName ?? null,
      reporterName: input.stamp?.reporterName ?? null,
      categoryName: input.stamp?.categoryName ?? null,
      photoId,
      accentColor: cfg?.accentColor ?? DEFAULT_STAMP_ACCENT,
      overlayAlpha: overlayAlphaFor(cfg?.overlayStrength ?? "auto"),
      sizeScale: SIZE_SCALE[size],
      timezone: DEFAULT_STAMP_TZ,
      showCoordinate: cfg?.showCoordinates ?? true,
      showReporter: cfg?.showReporter ?? true,
      showPhotoId: cfg?.showPhotoId ?? true,
      timeApprox,
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
      metadataSource: timeSource,
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
      takenAt: new Date("2026-07-25T16:15:00+07:00"),
      lat: -6.87101,
      lng: 109.253123,
      locationLabel: "KNMP Purwahamba",
      companyName: "CV. Putera Fahlevi",
      reporterName: "Prio Yulianto",
      categoryName: "Kondisi Eksisting",
      photoId: "PHB-250726-1615-003",
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
