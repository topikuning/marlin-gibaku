import "server-only";
import { db } from "@/lib/db";
import { jakartaToday } from "@/lib/format";

/**
 * PILIHAN SUMBER CUACA OTOMATIS (DECISIONS baru 2026-10-07) – di layar Sistem.
 *
 * - `open-meteo`: model cuaca (perilaku lama, tetap BAWAAN supaya tidak ada
 *   yang berubah diam-diam).
 * - `satelit`: pengamatan satelit – awan Himawari-9 + hujan JAXA GSMaP.
 *
 * Isian manual dari lapangan tetap menang atas keduanya.
 */

export const SUMBER_CUACA_KEY = "cuaca.sumber";
export const SUMBER_CUACA = ["open-meteo", "satelit"] as const;
export type SumberCuaca = (typeof SUMBER_CUACA)[number];
export const SUMBER_CUACA_DEFAULT: SumberCuaca = "open-meteo";

export const LABEL_SUMBER_CUACA: Record<SumberCuaca, string> = {
  "open-meteo": "Open-Meteo (model cuaca)",
  satelit: "Satelit (awan Himawari + hujan JAXA GSMaP)",
};

export async function getSumberCuaca(): Promise<SumberCuaca> {
  const row = await db.appSetting.findFirst({
    where: { key: SUMBER_CUACA_KEY },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  const v = row?.value.trim();
  return (SUMBER_CUACA as readonly string[]).includes(v ?? "") ? (v as SumberCuaca) : SUMBER_CUACA_DEFAULT;
}

export async function setSumberCuaca(sumber: SumberCuaca): Promise<void> {
  const effectiveFrom = jakartaToday();
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key: SUMBER_CUACA_KEY, effectiveFrom } },
    update: { value: sumber },
    create: { key: SUMBER_CUACA_KEY, value: sumber, effectiveFrom },
  });
}
