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
  // Pemilik pekerjaan = instansi yang memberi pekerjaan (KKP hari ini, bisa
  // pemkab/dinas lain besok). Dulu nama & logonya HARDCODE di kop blanko
  // harian; sekarang diisi lewat menu Sistem supaya satu basis kode melayani
  // klien mana pun (DECISIONS 166).
  ownerName: "Kementerian Kelautan dan Perikanan",
  ownerSubtitle: "Pembangunan Kampung Nelayan Merah Putih (KNMP)",
} as const;

export type Branding = {
  appName: string;
  tagline: string;
  projectContext: string;
  ownerName: string;
  ownerSubtitle: string;
  /** Key R2 logo pemilik pekerjaan (null = belum diunggah → kop tanpa logo). */
  ownerLogoKey: string | null;
};

export const BRAND_KEYS = {
  appName: "brand.app_name",
  tagline: "brand.tagline",
  projectContext: "brand.project_context",
  ownerName: "brand.owner_name",
  ownerSubtitle: "brand.owner_subtitle",
  ownerLogoKey: "brand.owner_logo_key",
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
    ownerName: pick(BRAND_KEYS.ownerName, BRAND_DEFAULTS.ownerName),
    ownerSubtitle: pick(BRAND_KEYS.ownerSubtitle, BRAND_DEFAULTS.ownerSubtitle),
    ownerLogoKey: latest.get(BRAND_KEYS.ownerLogoKey)?.trim() || null,
  };
}

/** Simpan branding (efektif hari ini, Asia/Jakarta). String kosong → hapus override (pakai default). */
export async function setBranding(input: Partial<Branding>): Promise<void> {
  const effectiveFrom = jakartaToday();
  const entries: [string, string | undefined][] = [
    [BRAND_KEYS.appName, input.appName],
    [BRAND_KEYS.tagline, input.tagline],
    [BRAND_KEYS.projectContext, input.projectContext],
    [BRAND_KEYS.ownerName, input.ownerName],
    [BRAND_KEYS.ownerSubtitle, input.ownerSubtitle],
    [BRAND_KEYS.ownerLogoKey, input.ownerLogoKey ?? undefined],
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
