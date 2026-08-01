/**
 * Utilitas murni untuk photo stamp — tanpa I/O, aman di-test & dipakai server
 * maupun preview. Semua warna aksen datang dari token (lihat config.ts), bukan
 * hardcode di sini.
 */

// ── Timezone lokasi proyek ────────────────────────────────────────────────────
export const STAMP_TZ = {
  "Asia/Jakarta": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
} as const;
export type StampTimezone = keyof typeof STAMP_TZ;
export const DEFAULT_STAMP_TZ: StampTimezone = "Asia/Jakarta";

export function isStampTimezone(v: unknown): v is StampTimezone {
  return typeof v === "string" && v in STAMP_TZ;
}

/**
 * Tanggal & waktu gaya stamp: "Sabtu, 25 Juli 2026 • 16:15 WIB".
 * Nama hari & bulan LENGKAP Bahasa Indonesia (locale id-ID); jam pakai pemisah
 * titik-dua (en-GB) supaya "16:15", bukan "16.15".
 */
export function formatStampDateTime(date: Date, tz: StampTimezone = DEFAULT_STAMP_TZ): string {
  const tanggal = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: tz,
  }).format(date);
  const jam = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(date);
  return `${tanggal} • ${jam} ${STAMP_TZ[tz]}`;
}

/**
 * Tanggal SAJA: "Jumat, 31 Juli 2026". Dipakai bila jam jepret tidak diketahui —
 * mencap "07:00 WIB" dari tanggal kerja (yang tersimpan sebagai DATE, jadi
 * tengah malam UTC = 07:00 WIB) adalah angka karangan. DECISIONS 197.
 */
export function formatStampDate(date: Date, tz: StampTimezone = DEFAULT_STAMP_TZ): string {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: tz,
  }).format(date);
}

// ── Koordinat ─────────────────────────────────────────────────────────────────
/** "6.871010°S, 109.253123°E" (6 desimal, arah mata angin N/S/E/W). */
export function formatCoordinate(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const la = `${Math.abs(lat).toFixed(6)}°${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lng).toFixed(6)}°${lng >= 0 ? "E" : "W"}`;
  return `${la}, ${lo}`;
}

// ── Kontras teks otomatis (WCAG) ──────────────────────────────────────────────
const CONTRAST_DARK = "#07182D";
const CONTRAST_LIGHT = "#FFFFFF";

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 255, g: 138, b: 0 }; // fallback #FF8A00
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/** Normalisasi ke "#RRGGBB" uppercase; kembalikan null bila tidak valid. */
export function normalizeHex(hex: string): string | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return `#${h.toUpperCase()}`;
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Luminance relatif WCAG (0..1). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(l1: number, l2: number): number {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Warna teks di atas `accent` agar terbaca: putih untuk aksen gelap, gelap
 * (#07182D) untuk aksen terang. Memilih rasio kontras tertinggi (target WCAG AA).
 */
export function getContrastText(accent: string): string {
  const la = relativeLuminance(accent);
  const cWhite = contrastRatio(relativeLuminance(CONTRAST_LIGHT), la);
  const cDark = contrastRatio(relativeLuminance(CONTRAST_DARK), la);
  return cDark > cWhite ? CONTRAST_DARK : CONTRAST_LIGHT;
}

// ── Photo ID ──────────────────────────────────────────────────────────────────
/** Kode lokasi 3 huruf dari nama (fallback "LOK"). Untuk komponen Photo ID. */
export function locationCodeFromName(name: string): string {
  const letters = (name || "").toUpperCase().replace(/[^A-Z]/g, "");
  return letters.slice(0, 3) || "LOK";
}

/**
 * Photo ID unik: `<KODE-LOKASI>-<YYMMDD>-<HHMM>-<URUT>` (urut 3 digit).
 * Contoh: PHB-250726-1615-003. Tanggal/jam dievaluasi di timezone lokasi proyek.
 */
export function generatePhotoId(
  locationCode: string,
  at: Date,
  sequence: number,
  tz: StampTimezone = DEFAULT_STAMP_TZ,
): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const ymd = `${get("year")}${get("month")}${get("day")}`;
  const hm = `${get("hour")}${get("minute")}`;
  const code = (locationCode || "LOK").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "LOK";
  return `${code}-${ymd}-${hm}-${String(Math.max(1, sequence)).padStart(3, "0")}`;
}
