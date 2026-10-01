import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * SETELAN PEMINDAHAN BERKAS KE LENOVO (DECISIONS 645) – di layar Sistem, bukan
 * variabel lingkungan, sama seperti sakelar arsip berkas asli.
 */

export const PINDAH_AKTIF_KEY = "pindah_berkas.aktif";
export const PINDAH_BATAS_GB_KEY = "pindah_berkas.batas_gb";
export const PINDAH_UMUR_HARI_KEY = "pindah_berkas.umur_hari";
/** Ukuran R2 terakhir yang terukur – JSON `{ bytes, obyek, pada }`. */
export const PINDAH_UKURAN_KEY = "pindah_berkas.ukuran_r2";

/** MATI sampai dinyalakan: fitur yang memindahkan berkas tidak menyala sendiri. */
export const PINDAH_AKTIF_DEFAULT = false;
/** Ketetapan user 2026-10-01: *"batas tetap 10 GB"*. */
export const PINDAH_BATAS_GB_DEFAULT = 10;
/**
 * Berkas yang lebih tua dari ini dipindah walau R2 masih jauh dari batas –
 * user: *"maksimalkan di disket/server lenovo"*. Dua minggu: foto dan dokumen
 * yang sedang dikerjakan (laporan pekan ini, revisi kontrak) tetap cepat dari
 * R2; yang lebih tua jarang dibuka.
 */
export const PINDAH_UMUR_HARI_DEFAULT = 14;

async function nilai(key: string): Promise<string | null> {
  const baris = await db.appSetting.findFirst({
    where: { key, effectiveFrom: { lte: jakartaToday() } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  return baris?.value ?? null;
}

async function simpan(key: string, value: string): Promise<void> {
  const effectiveFrom = jakartaToday();
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key, effectiveFrom } },
    create: { key, value, effectiveFrom },
    update: { value },
  });
}

export type SetelanPindah = { aktif: boolean; batasGb: number; umurHari: number };

export async function setelanPindah(): Promise<SetelanPindah> {
  const [a, b, u] = await Promise.all([nilai(PINDAH_AKTIF_KEY), nilai(PINDAH_BATAS_GB_KEY), nilai(PINDAH_UMUR_HARI_KEY)]);
  const batas = b == null ? PINDAH_BATAS_GB_DEFAULT : Number(b);
  const umur = u == null ? PINDAH_UMUR_HARI_DEFAULT : Number(u);
  return {
    aktif: a == null ? PINDAH_AKTIF_DEFAULT : a === "1",
    batasGb: Number.isFinite(batas) && batas >= 1 && batas <= 1000 ? batas : PINDAH_BATAS_GB_DEFAULT,
    umurHari: Number.isFinite(umur) && umur >= 3 && umur <= 3650 ? Math.floor(umur) : PINDAH_UMUR_HARI_DEFAULT,
  };
}

export async function simpanSetelanPindah(s: SetelanPindah): Promise<void> {
  await simpan(PINDAH_AKTIF_KEY, s.aktif ? "1" : "0");
  await simpan(PINDAH_BATAS_GB_KEY, String(s.batasGb));
  await simpan(PINDAH_UMUR_HARI_KEY, String(s.umurHari));
}

export type UkuranR2 = { bytes: number; obyek: number; pada: string };

export async function ukuranR2Terakhir(): Promise<UkuranR2 | null> {
  const v = await nilai(PINDAH_UKURAN_KEY);
  if (!v) return null;
  try {
    const j = JSON.parse(v) as UkuranR2;
    return typeof j.bytes === "number" && typeof j.pada === "string" ? j : null;
  } catch {
    return null;
  }
}

export async function catatUkuranR2(u: UkuranR2): Promise<void> {
  await simpan(PINDAH_UKURAN_KEY, JSON.stringify(u));
}
