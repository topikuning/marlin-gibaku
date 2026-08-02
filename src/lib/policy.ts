import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";
import { POLICY_DEFAULTS, type Policy } from "@/lib/policy-meta";

/**
 * KEBIJAKAN PENGENDALIAN yang bisa DIATUR, bukan dipaku di kode.
 *
 * Permintaan user 2026-08-02: "mengenai pagar penginput tidak boleh sama dengan
 * approval aku sepakat, tapi untuk saat ini kalau bisa itu dimaintain dengan
 * setingan, karena ini di awal, aku perlu keluwesan, jadi kalau nanti
 * dibutuhkan, tinggal klik di seting saja."
 *
 * Disimpan di `AppSetting` (key-value ber-tanggal-berlaku) seperti branding,
 * jadi perubahannya punya jejak waktu dan bisa ditelusuri.
 *
 * DEFAULT-nya MATI, dan itu keputusan sadar: menyalakannya di tengah pemakaian
 * awal akan membuat laporan yang sudah masuk mendadak tidak bisa disetujui oleh
 * satu-satunya orang yang ada di lokasi itu. Yang penting bukan menyalakannya
 * hari ini, melainkan bahwa menyalakannya nanti cuma sekali klik — dan sampai
 * itu terjadi, keadaannya TERBACA di halaman Sistem, bukan tersembunyi sebagai
 * asumsi. DECISIONS 218.
 */

export const POLICY_KEYS = {
  /** Penyetuju laporan harian tidak boleh orang yang mengirimnya. */
  approverMustDiffer: "policy.daily_report.approver_must_differ",
  /** Pemfinal laporan harian tidak boleh orang yang menyetujuinya. */
  finalizerMustDiffer: "policy.daily_report.finalizer_must_differ",
  /** Unggah foto laporan wajib membawa koordinat GPS asli dari perangkat. */
  requirePhotoGps: "policy.photo.require_device_gps",
} as const;

export type { Policy } from "@/lib/policy-meta";
export { POLICY_DEFAULTS, POLICY_META } from "@/lib/policy-meta";

/** Kebijakan efektif (nilai terbaru per key, fallback default). */
export async function getPolicy(): Promise<Policy> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: Object.values(POLICY_KEYS) } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  const latest = new Map<string, string>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r.value);
  const on = (key: string, def: boolean) => {
    const v = latest.get(key)?.trim();
    return v == null || v === "" ? def : v === "1" || v.toLowerCase() === "true";
  };
  return {
    approverMustDiffer: on(POLICY_KEYS.approverMustDiffer, POLICY_DEFAULTS.approverMustDiffer),
    finalizerMustDiffer: on(POLICY_KEYS.finalizerMustDiffer, POLICY_DEFAULTS.finalizerMustDiffer),
    requirePhotoGps: on(POLICY_KEYS.requirePhotoGps, POLICY_DEFAULTS.requirePhotoGps),
  };
}

/** Simpan kebijakan (berlaku hari ini, Asia/Jakarta). Hanya field yang dikirim yang diubah. */
export async function setPolicy(input: Partial<Policy>): Promise<void> {
  const effectiveFrom = jakartaToday();
  const entries: [string, boolean | undefined][] = [
    [POLICY_KEYS.approverMustDiffer, input.approverMustDiffer],
    [POLICY_KEYS.finalizerMustDiffer, input.finalizerMustDiffer],
    [POLICY_KEYS.requirePhotoGps, input.requirePhotoGps],
  ];
  for (const [key, val] of entries) {
    if (val === undefined) continue;
    const value = val ? "1" : "0";
    await db.appSetting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom } },
      update: { value },
      create: { key, value, effectiveFrom },
    });
  }
}
