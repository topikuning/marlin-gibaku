import type { LocationStatus } from "@/generated/prisma/enums";
import { LOCATION_STATUS_TONE } from "@/lib/lifecycle";

/**
 * SATU-SATUNYA tempat warna marker peta. Turunan dari tone status di
 * lifecycle.ts → token CSS var (tanpa hex baru). Leaflet butuh nilai literal
 * di pathOptions — resolve token via getComputedStyle di peta-map (client).
 */

const TONE_TOKEN: Record<(typeof LOCATION_STATUS_TONE)[LocationStatus], string> = {
  neutral: "--color-ink-faint",
  info: "--color-info",
  warning: "--color-warning",
  success: "--color-success",
  danger: "--color-danger",
};

/** Nama token CSS var untuk status lokasi, mis. "--color-info". */
export function statusColorToken(status: LocationStatus): string {
  return TONE_TOKEN[LOCATION_STATUS_TONE[status]];
}

/** Nilai siap pakai di inline style CSS: "var(--color-info)". */
export function statusColorCss(status: LocationStatus): string {
  return `var(${statusColorToken(status)})`;
}
