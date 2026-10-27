import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";
import type { WeekPeriodMode } from "@/lib/progress-calc";
import { isWeekPeriodMode } from "@/lib/periode-minggu";

/**
 * PERIODE MINGGU BAWAAN untuk kontrak BARU (DECISIONS 708).
 *
 * Diatur di Sistem, bukan ditulis di kode: periode minggu sudah berganti tiga
 * kali karena permintaan berbeda-beda, dan bawaan berikutnya cukup dipilih.
 * Kontrak yang sudah ada TIDAK ikut berubah – periodenya diganti per paket
 * lewat halaman kontrak (`contract.week_mode`), dengan konversi kurva-S.
 *
 * Disimpan di `AppSetting` bertanggal-berlaku seperti setelan lain, jadi
 * gantinya punya jejak waktu.
 */
export const MODE_MINGGU_BAWAAN_KEY = "kontrak.mode_minggu_bawaan" as const;

/** Bila belum pernah diatur: sama dengan bawaan skema (`Contract.weekMode`, DECISIONS 429). */
export const MODE_MINGGU_BAWAAN_AWAL: WeekPeriodMode = "senin_minggu";

export async function getModeMingguBawaan(): Promise<WeekPeriodMode> {
  const row = await db.appSetting.findFirst({
    where: { key: MODE_MINGGU_BAWAAN_KEY },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  const v = row?.value.trim();
  return isWeekPeriodMode(v) ? v : MODE_MINGGU_BAWAAN_AWAL;
}

export async function setModeMingguBawaan(mode: WeekPeriodMode): Promise<void> {
  const effectiveFrom = jakartaToday();
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key: MODE_MINGGU_BAWAAN_KEY, effectiveFrom } },
    update: { value: mode },
    create: { key: MODE_MINGGU_BAWAAN_KEY, value: mode, effectiveFrom },
  });
}
