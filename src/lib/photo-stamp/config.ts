import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";
import { normalizeHex } from "@/lib/photo-stamp/format";

/**
 * Konfigurasi Photo Stamp disimpan sebagai AppSetting (key-value, effective-dated)
 * — pola sama dengan Branding/WAHA. Warna aksen & opsi bisa diubah admin di
 * Sistem tanpa redeploy; langsung berlaku pada stamp berikutnya.
 */

export const DEFAULT_STAMP_ACCENT = "#FF8A00";
export type OverlayStrength = "auto" | "light" | "standard" | "strong";
export type StampSize = "compact" | "standard" | "large";

export type PhotoStampConfig = {
  accentColor: string;
  overlayStrength: OverlayStrength;
  size: StampSize;
  showCoordinates: boolean;
  showReporter: boolean;
  showPhotoId: boolean;
};

export const PHOTO_STAMP_DEFAULTS: PhotoStampConfig = {
  accentColor: DEFAULT_STAMP_ACCENT,
  overlayStrength: "auto",
  size: "standard",
  showCoordinates: true,
  showReporter: true,
  showPhotoId: true,
};

export const PHOTO_STAMP_KEYS = {
  accentColor: "photoStamp.accentColor",
  overlayStrength: "photoStamp.overlayStrength",
  size: "photoStamp.size",
  showCoordinates: "photoStamp.showCoordinates",
  showReporter: "photoStamp.showReporter",
  showPhotoId: "photoStamp.showPhotoId",
} as const;

const OVERLAYS: OverlayStrength[] = ["auto", "light", "standard", "strong"];
const SIZES: StampSize[] = ["compact", "standard", "large"];

async function latestSettings(): Promise<Map<string, string>> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: Object.values(PHOTO_STAMP_KEYS) } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  const latest = new Map<string, string>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r.value);
  return latest;
}

const asBool = (v: string | undefined, dflt: boolean) => (v == null ? dflt : v === "1" || v === "true");

/** Config efektif (dengan fallback default). */
export async function getPhotoStampConfig(): Promise<PhotoStampConfig> {
  const s = await latestSettings();
  const accent = normalizeHex(s.get(PHOTO_STAMP_KEYS.accentColor) ?? "") ?? PHOTO_STAMP_DEFAULTS.accentColor;
  const overlay = s.get(PHOTO_STAMP_KEYS.overlayStrength) as OverlayStrength | undefined;
  const size = s.get(PHOTO_STAMP_KEYS.size) as StampSize | undefined;
  return {
    accentColor: accent,
    overlayStrength: overlay && OVERLAYS.includes(overlay) ? overlay : PHOTO_STAMP_DEFAULTS.overlayStrength,
    size: size && SIZES.includes(size) ? size : PHOTO_STAMP_DEFAULTS.size,
    showCoordinates: asBool(s.get(PHOTO_STAMP_KEYS.showCoordinates), PHOTO_STAMP_DEFAULTS.showCoordinates),
    showReporter: asBool(s.get(PHOTO_STAMP_KEYS.showReporter), PHOTO_STAMP_DEFAULTS.showReporter),
    showPhotoId: asBool(s.get(PHOTO_STAMP_KEYS.showPhotoId), PHOTO_STAMP_DEFAULTS.showPhotoId),
  };
}

/** Simpan config (efektif hari ini). Field undefined = jangan ubah. */
export async function setPhotoStampConfig(input: Partial<PhotoStampConfig>): Promise<void> {
  const effectiveFrom = jakartaToday();
  const put = async (key: string, value: string) => {
    await db.appSetting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom } },
      update: { value },
      create: { key, value, effectiveFrom },
    });
  };
  if (input.accentColor !== undefined) {
    const hex = normalizeHex(input.accentColor) ?? DEFAULT_STAMP_ACCENT;
    await put(PHOTO_STAMP_KEYS.accentColor, hex);
  }
  if (input.overlayStrength !== undefined) await put(PHOTO_STAMP_KEYS.overlayStrength, input.overlayStrength);
  if (input.size !== undefined) await put(PHOTO_STAMP_KEYS.size, input.size);
  if (input.showCoordinates !== undefined) await put(PHOTO_STAMP_KEYS.showCoordinates, input.showCoordinates ? "1" : "0");
  if (input.showReporter !== undefined) await put(PHOTO_STAMP_KEYS.showReporter, input.showReporter ? "1" : "0");
  if (input.showPhotoId !== undefined) await put(PHOTO_STAMP_KEYS.showPhotoId, input.showPhotoId ? "1" : "0");
}
