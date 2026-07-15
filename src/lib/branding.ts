import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * Branding aplikasi — bisa diubah admin di menu Sistem supaya satu basis kode
 * dipakai lintas proyek (global). Disimpan di AppSetting (key-value, effective-
 * dated) dgn nilai efektif TERBARU yang dipakai.
 *
 * - appName + tagline = identitas produk (MARLIN + kepanjangannya), default global.
 * - projectContext    = konteks proyek saat ini (mis. KNMP) — bersifat TAMBAHAN.
 */

export const BRAND_DEFAULTS = {
  appName: "MARLIN",
  tagline: "Monitoring, Analysis, Reporting & Learning for Infrastructure Network",
  projectContext: "Pengendalian Proyek Kampung Nelayan Merah Putih (KNMP)",
} as const;

export type Branding = { appName: string; tagline: string; projectContext: string };

export const BRAND_KEYS = {
  appName: "brand.app_name",
  tagline: "brand.tagline",
  projectContext: "brand.project_context",
} as const;

/** Ambil branding efektif (nilai terbaru per key, fallback ke default). */
export async function getBranding(): Promise<Branding> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: Object.values(BRAND_KEYS) } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  const latest = new Map<string, string>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r.value);
  const pick = (key: string, def: string) => {
    const v = latest.get(key)?.trim();
    return v && v.length ? v : def;
  };
  return {
    appName: pick(BRAND_KEYS.appName, BRAND_DEFAULTS.appName),
    tagline: pick(BRAND_KEYS.tagline, BRAND_DEFAULTS.tagline),
    projectContext: pick(BRAND_KEYS.projectContext, BRAND_DEFAULTS.projectContext),
  };
}

/** Simpan branding (efektif hari ini, Asia/Jakarta). String kosong → hapus override (pakai default). */
export async function setBranding(input: Partial<Branding>): Promise<void> {
  const effectiveFrom = jakartaToday();
  const entries: [string, string | undefined][] = [
    [BRAND_KEYS.appName, input.appName],
    [BRAND_KEYS.tagline, input.tagline],
    [BRAND_KEYS.projectContext, input.projectContext],
  ];
  for (const [key, raw] of entries) {
    if (raw === undefined) continue;
    const value = raw.trim();
    await db.appSetting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom } },
      update: { value },
      create: { key, value, effectiveFrom },
    });
  }
}
